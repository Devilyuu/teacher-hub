import type { Prisma } from "@/lib/generated/prisma/client";

export type LockedMeeting = {
  id: string;
  minutes: string | null;
  resolutions: unknown;
};

export async function lockMeetingForUpdate(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  meetingId: string,
): Promise<LockedMeeting | null> {
  const rows = await tx.$queryRaw<LockedMeeting[]>`
    SELECT "id", "minutes", "resolutions"
    FROM "Meeting"
    WHERE "id" = ${meetingId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
