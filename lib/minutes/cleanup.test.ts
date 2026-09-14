import { describe, expect, test, vi } from "vitest";
import {
  removeRecordingAudio,
  runMinutesCleanupMaintenance,
  type AudioCleanupRepository,
} from "./cleanup";

function repository(overrides: Partial<AudioCleanupRepository> = {}): AudioCleanupRepository {
  return {
    claimAudioDeletion: vi.fn(async (id, now) => ({ id, storagePath: "recording-safe/audio.wav", claimedAt: now })),
    claimDueAudioDeletions: vi.fn(async () => []),
    completeAudioDeletion: vi.fn(async () => {}),
    failAudioDeletion: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("minutes audio cleanup", () => {
  test("deletes the owned recording directory before completing the fenced claim", async () => {
    const repo = repository();
    const remove = vi.fn(async () => {});
    const now = new Date("2026-08-03T00:00:00.000Z");

    await removeRecordingAudio("recording-1", { repository: repo, remove, now: () => now });

    expect(remove).toHaveBeenCalledWith("recording-safe/audio.wav");
    expect(repo.completeAudioDeletion).toHaveBeenCalledWith("recording-1", now, now);
  });

  test("keeps DELETE_PENDING and exposes only a safe message after filesystem failure", async () => {
    const repo = repository();
    const error = await removeRecordingAudio("recording-1", {
      repository: repo,
      remove: async () => { throw new Error("C:/private/recording-safe/audio.wav"); },
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    }).catch((caught) => caught);

    expect(repo.failAudioDeletion).toHaveBeenCalledOnce();
    expect(error.message).toBe("音频删除失败，已进入维护重试队列");
    expect(error.message).not.toContain("C:/private");
  });

  test("maintenance retries every claimed confirmed, expired, or DELETE_PENDING recording", async () => {
    const now = new Date("2026-08-10T00:00:00.000Z");
    const repo = repository({
      claimDueAudioDeletions: vi.fn(async () => [
        { id: "confirmed", storagePath: "recording-a/audio.wav", claimedAt: now },
        { id: "expired", storagePath: "recording-b/audio.wav", claimedAt: now },
        { id: "retry", storagePath: "recording-c/audio.wav", claimedAt: now },
      ]),
    });
    const remove = vi.fn(async (path: string) => {
      if (path.includes("recording-c")) throw new Error("disk busy");
    });

    const result = await runMinutesCleanupMaintenance({ repository: repo, remove, now: () => now });

    expect(result).toEqual({ audioCleanupClaimed: 3, audioDeleted: 2, audioDeleteFailed: 1 });
    expect(repo.completeAudioDeletion).toHaveBeenCalledTimes(2);
    expect(repo.failAudioDeletion).toHaveBeenCalledTimes(1);
  });

  test("a missing claim never touches the filesystem", async () => {
    const repo = repository({ claimAudioDeletion: vi.fn(async () => null) });
    const remove = vi.fn();

    await expect(removeRecordingAudio("recording-1", { repository: repo, remove })).rejects.toThrow("音频正在删除或已经删除");
    expect(remove).not.toHaveBeenCalled();
  });
});
