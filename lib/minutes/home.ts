import "server-only";

import type { PrismaClient } from "@/lib/generated/prisma/client";

export const HOME_MINUTES_LIMIT = 8;

const pendingMinutesWhere = {
  OR: [
    {
      confirmedAt: null,
      transcript: { not: null },
    },
    {
      status: "DELETE_PENDING" as const,
    },
  ],
};

const homeMinutesSelect = {
  id: true,
  originalName: true,
  status: true,
  errorCode: true,
  expiresAt: true,
  confirmedAt: true,
  audioDeletedAt: true,
  draftSummary: true,
  meetingId: true,
  meeting: { select: { title: true } },
  createdAt: true,
} as const;

export type MinutesHomeQueue = Awaited<ReturnType<typeof getMinutesHomeQueue>>;

export async function getMinutesHomeQueue(
  now: Date,
  client: Pick<PrismaClient, "meetingRecording">,
) {
  const daySixEnd = new Date(now.getTime() + 24 * 60 * 60_000);
  const total = await client.meetingRecording.count({ where: pendingMinutesWhere });
  const deleting = await client.meetingRecording.findMany({
    where: { status: "DELETE_PENDING" },
    select: homeMinutesSelect,
    orderBy: [{ errorCode: "desc" }, { createdAt: "asc" }],
    take: HOME_MINUTES_LIMIT,
  });
  const expiring = deleting.length < HOME_MINUTES_LIMIT
    ? await client.meetingRecording.findMany({
        where: {
          confirmedAt: null,
          transcript: { not: null },
          audioDeletedAt: null,
          status: { not: "DELETE_PENDING" },
          expiresAt: { lte: daySixEnd },
        },
        select: homeMinutesSelect,
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
        take: HOME_MINUTES_LIMIT - deleting.length,
      })
    : [];
  const normalLimit = HOME_MINUTES_LIMIT - deleting.length - expiring.length;
  const ordinary = normalLimit > 0
    ? await client.meetingRecording.findMany({
        where: {
          confirmedAt: null,
          transcript: { not: null },
          status: { not: "DELETE_PENDING" },
          OR: [
            { audioDeletedAt: { not: null } },
            { expiresAt: null },
            { expiresAt: { gt: daySixEnd } },
          ],
        },
        select: homeMinutesSelect,
        orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: normalLimit,
      })
    : [];
  const records = [...deleting, ...expiring, ...ordinary];
  const items = records.map((record) => {
    const retryDelete = record.status === "DELETE_PENDING" && record.errorCode === "AUDIO_DELETE_FAILED";
    const deletionPending = record.status === "DELETE_PENDING" && !retryDelete;
    const daySixReminder = !retryDelete
      && !deletionPending
      && record.confirmedAt === null
      && record.audioDeletedAt === null
      && record.expiresAt !== null
      && record.expiresAt > now
      && record.expiresAt <= daySixEnd;
    return {
      id: record.id,
      meetingId: record.meetingId,
      meetingTitle: record.meeting.title,
      recordingName: record.originalName,
      expiresAt: record.expiresAt,
      daySixReminder,
      expiredReminder: !retryDelete
        && !deletionPending
        && record.confirmedAt === null
        && record.audioDeletedAt === null
        && record.expiresAt !== null
        && record.expiresAt <= now,
      action: retryDelete
        ? "retry-delete" as const
        : deletionPending
          ? "deletion-pending" as const
          : record.draftSummary === null
            ? "organize" as const
            : "review" as const,
      href: `/meetings/${record.meetingId}#recording-${record.id}`,
    };
  });
  return { items, total, remaining: Math.max(0, total - items.length) };
}
