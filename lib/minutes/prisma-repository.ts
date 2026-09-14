import "server-only";

import { z } from "zod";
import { dateOnly } from "@/lib/date";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { lockMeetingForUpdate } from "@/lib/meeting-lock";
import type { TranscriptSegment } from "@/lib/transcription/types";
import { mergeAutomaticMinutes, mergeAutomaticResolutions, type AutomaticFormalResolution } from "./formal";
import { minutesDraftSchema, type MinutesDraft } from "./schema";
import type { MinutesRepository } from "./service";
import type { AudioCleanupRepository, AudioDeletionClaim } from "./cleanup";

const transcriptSegmentsSchema = z.array(z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speakerId: z.number().int().nullable(),
}).strict());

type LockedRecording = {
  id: string;
  meetingId: string;
  originalName: string;
  createdAt: Date;
  status: "UPLOADING" | "UPLOADED" | "TRANSCRIBING" | "TRANSCRIBED" | "DRAFT_READY" | "CONFIRMED" | "DELETE_PENDING" | "AUDIO_DELETED" | "FAILED";
  transcript: string | null;
  draftSummary: string | null;
  draftDiscussion: string | null;
  draftResolutions: unknown;
  draftTasks: unknown;
  draftOpenIssues: unknown;
  confirmedAt: Date | null;
  audioDeletedAt: Date | null;
  storagePath: string | null;
};

function dueDate(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return dateOnly(year!, month!, day!);
}

function formalSegment(row: Pick<LockedRecording, "id" | "originalName">, draft: MinutesDraft): string {
  const sections = [
    `录音分段：${row.originalName}\n记录 ID：${row.id}`,
    draft.summary ? `摘要\n${draft.summary}` : "",
    draft.discussion ? `讨论\n${draft.discussion}` : "",
    draft.openIssues.length > 0
      ? `未决事项\n${draft.openIssues.map((issue) => `- ${issue.text}`).join("\n")}`
      : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

function aggregateFormalMinutes(
  recordings: LockedRecording[],
  previousResolutions: unknown,
): { automaticMinutes: string; resolutions: Prisma.InputJsonValue } {
  const sections: string[] = [];
  const automaticResolutions: AutomaticFormalResolution[] = [];
  for (const recording of recordings) {
    const draft = parseDraft(recording);
    sections.push(formalSegment(recording, draft));
    for (const resolution of draft.resolutions) {
      automaticResolutions.push({
        recordingId: recording.id,
        candidateId: resolution.id,
        text: resolution.text,
        assignee: resolution.assignee,
        dueDate: resolution.dueDate,
        convertedTaskId: null,
      });
    }
  }
  return {
    automaticMinutes: sections.join("\n\n---\n\n"),
    resolutions: mergeAutomaticResolutions(previousResolutions, automaticResolutions) as Prisma.InputJsonValue,
  };
}

function hasContent(draft: MinutesDraft): boolean {
  return Boolean(
    draft.summary || draft.discussion || draft.resolutions.length || draft.tasks.length || draft.openIssues.length,
  );
}

function parseDraft(row: LockedRecording): MinutesDraft {
  return minutesDraftSchema.parse({
    summary: row.draftSummary,
    discussion: row.draftDiscussion,
    resolutions: row.draftResolutions,
    tasks: row.draftTasks,
    openIssues: row.draftOpenIssues,
  });
}

export function createPrismaMinutesRepository(client: PrismaClient): MinutesRepository & AudioCleanupRepository {
  return {
    async getDraftSource(id) {
      const recording = await client.meetingRecording.findUnique({
        where: { id },
        select: { transcript: true, transcriptSegments: true, confirmedAt: true },
      });
      if (!recording?.transcript) return null;
      const parsed = transcriptSegmentsSchema.safeParse(recording.transcriptSegments);
      return {
        transcript: recording.transcript,
        transcriptSegments: parsed.success ? parsed.data satisfies TranscriptSegment[] : [],
        confirmedAt: recording.confirmedAt,
      };
    },

    async saveDraft(id, draft) {
      const updated = await client.$executeRaw`
        UPDATE "MeetingRecording"
        SET "draftSummary" = ${draft.summary},
            "draftDiscussion" = ${draft.discussion},
            "draftResolutions" = ${JSON.stringify(draft.resolutions)}::jsonb,
            "draftTasks" = ${JSON.stringify(draft.tasks)}::jsonb,
            "draftOpenIssues" = ${JSON.stringify(draft.openIssues)}::jsonb,
            "status" = CASE
              WHEN "status" IN ('DELETE_PENDING', 'AUDIO_DELETED') THEN "status"
              ELSE 'DRAFT_READY'::"RecordingStatus"
            END,
            "errorCode" = CASE
              WHEN "status" = 'DELETE_PENDING' THEN "errorCode"
              ELSE NULL
            END,
            "errorNote" = CASE
              WHEN "status" = 'DELETE_PENDING' THEN "errorNote"
              ELSE NULL
            END,
            "updatedAt" = NOW()
        WHERE "id" = ${id}
          AND "transcript" IS NOT NULL
          AND "confirmedAt" IS NULL
      `;
      return updated === 1;
    },

    async recordGenerationFailure(id, failure) {
      const updated = await client.$executeRaw`
        UPDATE "MeetingRecording"
        SET "errorCode" = CASE
              WHEN "status" = 'DELETE_PENDING' THEN "errorCode"
              ELSE ${failure.errorCode}
            END,
            "errorNote" = CASE
              WHEN "status" = 'DELETE_PENDING' THEN "errorNote"
              ELSE ${failure.errorNote}
            END,
            "updatedAt" = NOW()
        WHERE "id" = ${id}
          AND "transcript" IS NOT NULL
          AND "confirmedAt" IS NULL
      `;
      return updated === 1;
    },

    confirm(id, draft, now) {
      return client.$transaction(async (tx) => {
        const recordingReferences = await tx.$queryRaw<Array<{ meetingId: string }>>`
          SELECT "meetingId"
          FROM "MeetingRecording"
          WHERE "id" = ${id}
        `;
        const meetingId = recordingReferences[0]?.meetingId;
        if (!meetingId) throw new Error("这条录音不存在");

        const meeting = await lockMeetingForUpdate(tx, meetingId);
        if (!meeting) throw new Error("所属会议不存在");

        const rows = await tx.$queryRaw<LockedRecording[]>`
          SELECT "id", "meetingId", "originalName", "createdAt", "status", "transcript",
                 "draftSummary", "draftDiscussion", "draftResolutions", "draftTasks", "draftOpenIssues",
                 "confirmedAt", "audioDeletedAt", "storagePath"
          FROM "MeetingRecording"
          WHERE "id" = ${id}
            AND "meetingId" = ${meetingId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row?.transcript) throw new Error("这条录音没有可确认的转写");
        const persistedDraft = row.confirmedAt ? parseDraft(row) : null;
        const persistedTaskIds = (persistedDraft?.tasks ?? [])
          .map((task) => task.createdTaskId)
          .filter((taskId): taskId is string => taskId !== null);
        if (row.confirmedAt) {
          return {
            alreadyConfirmed: true,
            needsAudioCleanup: row.audioDeletedAt === null && row.storagePath !== null,
            taskIds: persistedTaskIds,
          };
        }
        if (!hasContent(draft)) throw new Error("纪要草稿还是空的，请先整理后再确认");

        const taskIds: string[] = [];
        const confirmedTasks: MinutesDraft["tasks"] = [];
        for (const candidate of draft.tasks) {
          if (!candidate.selected) {
            confirmedTasks.push(candidate);
            continue;
          }
          const task = await tx.task.create({
            data: {
              title: candidate.title,
              source: "MEETING",
              assignee: candidate.assignee,
              dueDate: dueDate(candidate.dueDate),
              sourceMeetingId: row.meetingId,
            },
            select: { id: true },
          });
          taskIds.push(task.id);
          confirmedTasks.push({ ...candidate, createdTaskId: task.id });
        }

        const status = row.audioDeletedAt
          ? "AUDIO_DELETED"
          : row.status === "DELETE_PENDING"
            ? "DELETE_PENDING"
            : "CONFIRMED";
        await tx.meetingRecording.update({
          where: { id },
          data: {
            draftSummary: draft.summary,
            draftDiscussion: draft.discussion,
            draftResolutions: draft.resolutions as Prisma.InputJsonValue,
            draftTasks: confirmedTasks as Prisma.InputJsonValue,
            draftOpenIssues: draft.openIssues as Prisma.InputJsonValue,
            confirmedAt: now,
            status,
          },
        });

        const confirmedRecordings = await tx.meetingRecording.findMany({
          where: { meetingId, confirmedAt: { not: null } },
          select: {
            id: true,
            meetingId: true,
            originalName: true,
            createdAt: true,
            status: true,
            transcript: true,
            draftSummary: true,
            draftDiscussion: true,
            draftResolutions: true,
            draftTasks: true,
            draftOpenIssues: true,
            confirmedAt: true,
            audioDeletedAt: true,
            storagePath: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const formal = aggregateFormalMinutes(confirmedRecordings as LockedRecording[], meeting.resolutions);
        await tx.meeting.update({
          where: { id: meetingId },
          data: {
            minutes: mergeAutomaticMinutes(meeting.minutes, formal.automaticMinutes),
            resolutions: formal.resolutions,
          },
        });
        return {
          alreadyConfirmed: false,
          needsAudioCleanup: row.audioDeletedAt === null && row.storagePath !== null,
          taskIds,
        };
      });
    },

    async claimAudioDeletion(id: string, now: Date, leaseMinutes: number): Promise<AudioDeletionClaim | null> {
      const cutoff = new Date(now.getTime() - leaseMinutes * 60_000);
      const rows = await client.$queryRaw<AudioDeletionClaim[]>`
        UPDATE "MeetingRecording"
        SET "status" = 'DELETE_PENDING',
            "claimedAt" = ${now},
            "errorCode" = 'AUDIO_DELETE_PENDING',
            "errorNote" = '音频等待删除',
            "updatedAt" = ${now}
        WHERE "id" = ${id}
          AND "audioDeletedAt" IS NULL
          AND "storagePath" IS NOT NULL
          AND "status" NOT IN ('UPLOADING', 'TRANSCRIBING', 'AUDIO_DELETED')
          AND (
            "status" <> 'DELETE_PENDING'
            OR "claimedAt" IS NULL
            OR "claimedAt" <= ${cutoff}
          )
        RETURNING "id", "storagePath", "claimedAt"
      `;
      return rows[0] ?? null;
    },

    async claimDueAudioDeletions(now: Date, leaseMinutes: number, limit: number): Promise<AudioDeletionClaim[]> {
      const cutoff = new Date(now.getTime() - leaseMinutes * 60_000);
      return client.$queryRaw<AudioDeletionClaim[]>`
        WITH candidates AS (
          SELECT r."id"
          FROM "MeetingRecording" AS r
          WHERE r."audioDeletedAt" IS NULL
            AND r."storagePath" IS NOT NULL
            AND r."status" NOT IN ('UPLOADING', 'TRANSCRIBING', 'AUDIO_DELETED')
            AND (
              (
                r."status" = 'DELETE_PENDING'
                AND (r."claimedAt" IS NULL OR r."claimedAt" <= ${cutoff})
              )
              OR (
                r."status" <> 'DELETE_PENDING'
                AND (
                  r."confirmedAt" IS NOT NULL
                  OR (r."transcript" IS NOT NULL AND r."expiresAt" <= ${now})
                )
              )
            )
          ORDER BY COALESCE(r."expiresAt", r."createdAt") ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "MeetingRecording" AS r
        SET "status" = 'DELETE_PENDING',
            "claimedAt" = ${now},
            "errorCode" = 'AUDIO_DELETE_PENDING',
            "errorNote" = '音频等待删除',
            "updatedAt" = ${now}
        FROM candidates AS c
        WHERE r."id" = c."id"
        RETURNING r."id", r."storagePath", r."claimedAt"
      `;
    },

    async completeAudioDeletion(id: string, claimedAt: Date, deletedAt: Date) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "DELETE_PENDING", claimedAt },
        data: {
          status: "AUDIO_DELETED",
          audioDeletedAt: deletedAt,
          storagePath: null,
          claimedAt: null,
          errorCode: null,
          errorNote: null,
        },
      });
      if (result.count !== 1) throw new Error("音频删除租约已失效");
    },

    async failAudioDeletion(id: string, claimedAt: Date) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "DELETE_PENDING", claimedAt },
        data: {
          errorCode: "AUDIO_DELETE_FAILED",
          errorNote: "音频删除失败，已进入维护重试队列",
        },
      });
      if (result.count !== 1) throw new Error("音频删除租约已失效");
    },
  };
}
