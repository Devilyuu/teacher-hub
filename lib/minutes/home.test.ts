import { describe, expect, test, vi } from "vitest";
import { getMinutesHomeQueue } from "./home";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "recording-1",
    originalName: "例会.wav",
    status: "DRAFT_READY",
    errorCode: null,
    expiresAt: new Date("2026-08-10T00:00:00.000Z"),
    confirmedAt: null,
    audioDeletedAt: null,
    meetingId: "meeting-1",
    meeting: { title: "八月例会" },
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    ...overrides,
  };
}

describe("minutes home queue", () => {
  test("caps the group at eight and returns total, remaining, and direct meeting links", async () => {
    const rows = Array.from({ length: 8 }, (_, index) => row({ id: `recording-${index + 1}` }));
    const client = {
      meetingRecording: {
        count: vi.fn(async () => 11),
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if (args.where.status === "DELETE_PENDING" || "expiresAt" in args.where) return [];
          return rows;
        }),
      },
    };

    const queue = await getMinutesHomeQueue(new Date("2026-08-03T00:00:00.000Z"), client as never);

    expect(queue).toMatchObject({ total: 11, remaining: 3 });
    expect(queue.items).toHaveLength(8);
    expect(queue.items[0]).toMatchObject({
      action: "review",
      href: "/meetings/meeting-1#recording-recording-1",
    });
    expect(client.meetingRecording.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "DELETE_PENDING" },
      take: 8,
    }));
    expect(client.meetingRecording.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        confirmedAt: null,
        transcript: { not: null },
        status: { not: "DELETE_PENDING" },
        OR: expect.any(Array),
      },
    }));
  });

  test("includes transcribed recordings before a minutes draft exists", async () => {
    const client = {
      meetingRecording: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if (args.where.status === "DELETE_PENDING") return [];
          if ("expiresAt" in args.where) return [row({
            status: "TRANSCRIBED",
            draftSummary: null,
            expiresAt: new Date("2026-08-03T12:00:00.000Z"),
          })];
          return [];
        }),
      },
    };

    const queue = await getMinutesHomeQueue(new Date("2026-08-03T00:00:00.000Z"), client as never);

    expect(queue.items[0]).toMatchObject({ id: "recording-1", daySixReminder: true, action: "organize" });
  });

  test("marks only the last 24 hours before expiry as the day-six reminder", async () => {
    const client = {
      meetingRecording: {
        count: vi.fn(async () => 2),
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if (args.where.status === "DELETE_PENDING") return [];
          if ("expiresAt" in args.where) {
            return [row({ id: "day-six", expiresAt: new Date("2026-08-03T23:59:59.000Z") })];
          }
          return [row({ id: "later", expiresAt: new Date("2026-08-04T00:00:01.000Z") })];
        }),
      },
    };

    const queue = await getMinutesHomeQueue(new Date("2026-08-03T00:00:00.000Z"), client as never);

    expect(queue.items.map((item) => [item.id, item.daySixReminder])).toEqual([
      ["day-six", true],
      ["later", false],
    ]);
  });

  test("surfaces failed DELETE_PENDING work as a direct retry action even after confirmation", async () => {
    const client = {
      meetingRecording: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
          if (args.where.status !== "DELETE_PENDING") return [];
          return [row({
            status: "DELETE_PENDING",
            errorCode: "AUDIO_DELETE_FAILED",
            confirmedAt: new Date("2026-08-03T00:00:00.000Z"),
          })];
        }),
      },
    };

    const queue = await getMinutesHomeQueue(new Date("2026-08-03T00:00:00.000Z"), client as never);

    expect(queue.items[0]).toMatchObject({ action: "retry-delete", daySixReminder: false });
  });

  test("prioritizes delete work and last-24-hour reminders before truncating ordinary records", async () => {
    const ordinary = Array.from({ length: 10 }, (_, index) => row({
      id: `ordinary-${index + 1}`,
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
    }));
    const deleting = row({
      id: "deleting",
      status: "DELETE_PENDING",
      errorCode: "AUDIO_DELETE_FAILED",
      confirmedAt: new Date("2026-08-02T00:00:00.000Z"),
    });
    const expiring = row({ id: "expiring", expiresAt: new Date("2026-08-03T12:00:00.000Z") });
    const findMany = vi.fn(async (args: { where: Record<string, unknown>; take: number }) => {
      if (args.where.status === "DELETE_PENDING") return [deleting];
      if ("expiresAt" in args.where) return [expiring];
      return ordinary.slice(0, args.take);
    });
    const client = { meetingRecording: { count: vi.fn(async () => 12), findMany } };

    const queue = await getMinutesHomeQueue(new Date("2026-08-03T00:00:00.000Z"), client as never);

    expect(queue.items).toHaveLength(8);
    expect(queue.items.slice(0, 2).map((item) => item.id)).toEqual(["deleting", "expiring"]);
    expect(queue.remaining).toBe(4);
  });
});
