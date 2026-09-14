import "server-only";

import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { dateOnly } from "@/lib/date";
import { normalizeLineEndings } from "@/lib/line-endings";
import { lockMeetingForUpdate } from "@/lib/meeting-lock";
import {
  resolutionEntries,
  resolutionMatchesConvertedIdentity,
  resolutionMatchesSnapshot,
  type Resolution,
  type ResolutionSnapshot,
} from "@/lib/meetings";

type TransactionalClient = Pick<PrismaClient, "$transaction">;

export async function saveMeetingMinutes(
  client: TransactionalClient,
  meetingId: string,
  originalMinutes: string,
  nextMinutes: string,
): Promise<"saved" | "conflict" | "not-found"> {
  return client.$transaction(async (tx) => {
    const meeting = await lockMeetingForUpdate(tx, meetingId);
    if (!meeting) return "not-found";
    if (normalizeLineEndings(meeting.minutes ?? "") !== normalizeLineEndings(originalMinutes)) return "conflict";

    await tx.meeting.update({ where: { id: meetingId }, data: { minutes: nextMinutes } });
    return "saved";
  });
}

export async function addMeetingResolution(
  client: TransactionalClient,
  meetingId: string,
  resolution: Resolution,
): Promise<"added" | "not-found"> {
  return client.$transaction(async (tx) => {
    const meeting = await lockMeetingForUpdate(tx, meetingId);
    if (!meeting) return "not-found";
    const resolutions = Array.isArray(meeting.resolutions) ? [...meeting.resolutions] : [];
    resolutions.push(resolution);
    await tx.meeting.update({
      where: { id: meetingId },
      data: { resolutions: resolutions as Prisma.InputJsonValue },
    });
    return "added";
  });
}

export async function removeMeetingResolution(
  client: TransactionalClient,
  meetingId: string,
  index: number,
  expected: ResolutionSnapshot,
): Promise<"removed" | "conflict" | "invalid-index" | "not-found"> {
  return client.$transaction(async (tx) => {
    const meeting = await lockMeetingForUpdate(tx, meetingId);
    if (!meeting) return "not-found";
    const entries = resolutionEntries(meeting.resolutions);
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return "invalid-index";
    const target = entries[index]!;
    if (!resolutionMatchesSnapshot(target.resolution, expected)) return "conflict";
    const resolutions = Array.isArray(meeting.resolutions) ? [...meeting.resolutions] : [];
    resolutions.splice(target.rawIndex, 1);
    await tx.meeting.update({
      where: { id: meetingId },
      data: { resolutions: resolutions as Prisma.InputJsonValue },
    });
    return "removed";
  });
}

export type ConvertResolutionResult =
  | { status: "converted"; taskId: string }
  | { status: "already-converted"; taskId: string }
  | { status: "conflict" }
  | { status: "invalid-index" }
  | { status: "not-found" };

export async function convertMeetingResolutionToTask(
  client: TransactionalClient,
  meetingId: string,
  index: number,
  expected: ResolutionSnapshot,
): Promise<ConvertResolutionResult> {
  return client.$transaction(async (tx) => {
    const meeting = await lockMeetingForUpdate(tx, meetingId);
    if (!meeting) return { status: "not-found" };
    const entries = resolutionEntries(meeting.resolutions);
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return { status: "invalid-index" };

    const target = entries[index]!;
    const resolution = target.resolution;
    if (!resolutionMatchesSnapshot(resolution, expected)) {
      if (resolutionMatchesConvertedIdentity(resolution, expected)) {
        return { status: "already-converted", taskId: resolution.convertedTaskId! };
      }
      return { status: "conflict" };
    }
    if (resolution.convertedTaskId) {
      return { status: "already-converted", taskId: resolution.convertedTaskId };
    }
    const due = resolution.dueDate?.split("-").map(Number);
    const task = await tx.task.create({
      data: {
        title: resolution.text,
        source: "MEETING",
        assignee: resolution.assignee,
        dueDate: due && due.length === 3 ? dateOnly(due[0]!, due[1]!, due[2]!) : null,
        sourceMeetingId: meetingId,
      },
      select: { id: true },
    });
    const resolutions = Array.isArray(meeting.resolutions) ? [...meeting.resolutions] : [];
    resolutions[target.rawIndex] = { ...target.raw, convertedTaskId: task.id };
    await tx.meeting.update({
      where: { id: meetingId },
      data: { resolutions: resolutions as Prisma.InputJsonValue },
    });
    return { status: "converted", taskId: task.id };
  });
}
