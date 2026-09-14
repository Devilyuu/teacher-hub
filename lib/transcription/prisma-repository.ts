import "server-only";

import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import type { ClaimedRecording, TranscriptionRepository, UploadCleanupClaim } from "./service";

type Client = PrismaClient;

export function createPrismaTranscriptionRepository(client: Client) {
  return {
    getMeeting(id: string) {
      return client.meeting.findUnique({
        where: { id },
        select: { id: true, transcriptionEnabled: true },
      });
    },

    reserve(meetingId: string, data: {
      source: "UPLOAD";
      originalName: string;
      mimeType: string;
      bytes: number;
      storagePath: string;
      cloudConsentAt: Date | null;
      quotaBytes: number;
    }) {
      return client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('teacher-desk-audio-quota'))`;
        const usage = await tx.meetingRecording.aggregate({
          where: { status: { not: "AUDIO_DELETED" } },
          _sum: { bytes: true },
        });
        if ((usage._sum.bytes ?? 0) + data.bytes > data.quotaBytes) {
          throw new Error("录音总量已满，请先确认或删除既有录音");
        }
        const claimedAt = new Date();
        const reservation = await tx.meetingRecording.create({
          data: {
            meetingId,
            source: data.source,
            status: "UPLOADING",
            originalName: data.originalName,
            mimeType: data.mimeType,
            bytes: data.bytes,
            storagePath: data.storagePath,
            cloudConsentAt: data.cloudConsentAt,
            claimedAt,
          },
          select: { id: true, claimedAt: true },
        });
        if (!reservation.claimedAt) throw new Error("上传预留缺少租约");
        return { id: reservation.id, claimedAt: reservation.claimedAt };
      });
    },

    async finalize(id: string, claimedAt: Date, data: { durationSec: number }) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "UPLOADING", claimedAt },
        data: { ...data, status: "UPLOADED", claimedAt: null, errorCode: null, errorNote: null },
      });
      if (result.count !== 1) throw new Error("录音上传租约已失效");
    },

    async discard(id: string, claimedAt: Date) {
      await client.meetingRecording.deleteMany({ where: { id, status: "UPLOADING", claimedAt } });
    },

    async claimStaleUploads(now: Date, leaseMinutes: number): Promise<UploadCleanupClaim[]> {
      const cutoff = new Date(now.getTime() - leaseMinutes * 60_000);
      return client.$queryRaw<UploadCleanupClaim[]>`
        WITH candidates AS (
          SELECT r."id"
          FROM "MeetingRecording" AS r
          WHERE r."status" = 'UPLOADING'
            AND r."claimedAt" <= ${cutoff}
            AND r."storagePath" IS NOT NULL
          ORDER BY r."createdAt" ASC
          LIMIT 20
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "MeetingRecording" AS r
        SET "claimedAt" = ${now},
            "errorCode" = 'UPLOAD_CLEANUP_PENDING',
            "errorNote" = '过期上传等待清理',
            "updatedAt" = ${now}
        FROM candidates AS c
        WHERE r."id" = c."id"
        RETURNING r."id", r."storagePath", r."claimedAt"
      `;
    },

    async completeUploadCleanup(id: string, claimedAt: Date) {
      const result = await client.meetingRecording.deleteMany({
        where: { id, status: "UPLOADING", claimedAt },
      });
      if (result.count !== 1) throw new Error("上传清理租约已失效");
    },

    async failUploadCleanup(id: string, claimedAt: Date) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "UPLOADING", claimedAt },
        data: {
          errorCode: "UPLOAD_CLEANUP_FAILED",
          errorNote: "过期上传清理失败，稍后重试",
        },
      });
      if (result.count !== 1) throw new Error("上传清理租约已失效");
    },

    async claim(id: string, now: Date, leaseMinutes: number): Promise<ClaimedRecording | null> {
      const cutoff = new Date(now.getTime() - leaseMinutes * 60_000);
      const rows = await client.$queryRaw<ClaimedRecording[]>`
        UPDATE "MeetingRecording" AS r
        SET "status" = 'TRANSCRIBING',
            "claimedAt" = ${now},
            "attempts" = r."attempts" + 1,
            "errorCode" = NULL,
            "errorNote" = NULL,
            "updatedAt" = ${now}
        FROM "Meeting" AS m
        WHERE r."id" = ${id}
          AND m."id" = r."meetingId"
          AND m."transcriptionEnabled" = true
          AND r."cloudConsentAt" IS NOT NULL
          AND r."status" IN ('UPLOADED', 'FAILED')
          AND (r."claimedAt" IS NULL OR r."claimedAt" <= ${cutoff})
          AND r."storagePath" IS NOT NULL
        RETURNING r."id", r."claimedAt", r."bytes", r."storagePath", r."mimeType", r."originalName"
      `;
      return rows[0] ?? null;
    },

    async complete(id: string, claimedAt: Date, data: {
      provider: string;
      providerTaskId: string;
      transcript: string;
      transcriptSegments: Prisma.InputJsonValue;
      durationSec: number;
      expiresAt: Date;
      claimedAt: null;
    }) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "TRANSCRIBING", claimedAt },
        data: { ...data, status: "TRANSCRIBED", errorCode: null, errorNote: null },
      });
      if (result.count !== 1) throw new Error("转写租约已失效，结果未写入");
    },

    async fail(id: string, claimedAt: Date, data: { errorCode: string; errorNote: string; claimedAt: null }) {
      const result = await client.meetingRecording.updateMany({
        where: { id, status: "TRANSCRIBING", claimedAt },
        data: { ...data, status: "FAILED" },
      });
      if (result.count !== 1) throw new Error("转写租约已失效，失败状态未覆盖新任务");
    },

    async recoverExpired(now: Date, leaseMinutes: number): Promise<number> {
      const cutoff = new Date(now.getTime() - leaseMinutes * 60_000);
      const result = await client.meetingRecording.updateMany({
        where: { status: "TRANSCRIBING", claimedAt: { lte: cutoff } },
        data: {
          status: "UPLOADED",
          claimedAt: null,
          errorCode: "LEASE_EXPIRED",
          errorNote: "转写租约已过期，已等待重试",
        },
      });
      return result.count;
    },

    async listStaleUploaded(now: Date): Promise<string[]> {
      const records = await client.meetingRecording.findMany({
        where: {
          status: "UPLOADED",
          cloudConsentAt: { not: null },
          createdAt: { lte: new Date(now.getTime() - 10 * 60_000) },
          meeting: { transcriptionEnabled: true },
        },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true },
      });
      return records.map((record) => record.id);
    },
  } satisfies TranscriptionRepository & {
    getMeeting(id: string): Promise<{ id: string; transcriptionEnabled: boolean } | null>;
    reserve(meetingId: string, data: {
      source: "UPLOAD"; originalName: string; mimeType: string; bytes: number; storagePath: string;
      cloudConsentAt: Date | null; quotaBytes: number;
    }): Promise<{ id: string; claimedAt: Date }>;
    finalize(id: string, claimedAt: Date, data: { durationSec: number }): Promise<void>;
    discard(id: string, claimedAt: Date): Promise<void>;
    claimStaleUploads(now: Date, leaseMinutes: number): Promise<UploadCleanupClaim[]>;
    completeUploadCleanup(id: string, claimedAt: Date): Promise<void>;
    failUploadCleanup(id: string, claimedAt: Date): Promise<void>;
    recoverExpired(now: Date, leaseMinutes: number): Promise<number>;
    listStaleUploaded(now: Date): Promise<string[]>;
  };
}
