import { describe, expect, it, vi } from "vitest";
import { TencentTranscriptionError } from "./tencent";
import { runTranscription, runTranscriptionMaintenance } from "./service";

const claimed = {
  id: "recording-1",
  claimedAt: new Date("2026-08-03T04:00:00Z"),
  bytes: 20,
  storagePath: "recording-safe/audio.wav",
  mimeType: "audio/wav",
  originalName: "audio.wav",
};

describe("runTranscription", () => {
  it("claims once, persists request_id and transcript, and clears the lease", async () => {
    const repository = {
      claim: vi.fn(async () => claimed),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    };
    const adapter = {
      provider: "fake",
      transcribe: vi.fn(async () => ({
        providerTaskId: "request-1",
        durationSec: 61,
        transcript: "transcript",
        segments: [{ text: "segment", startMs: 0, endMs: 1000, speakerId: 0 }],
      })),
    };
    const now = new Date("2026-08-03T04:00:00Z");
    await expect(runTranscription("recording-1", {
      repository,
      adapter,
      resolvePath: async () => "/private/audio.wav",
      now: () => now,
      leaseMinutes: 30,
    })).resolves.toEqual({ status: "TRANSCRIBED" });
    expect(repository.claim).toHaveBeenCalledWith("recording-1", now, 30);
    expect(adapter.transcribe).toHaveBeenCalledWith({ path: "/private/audio.wav", bytes: 20, voiceFormat: "wav" });
    expect(repository.complete).toHaveBeenCalledWith(
      "recording-1",
      new Date("2026-08-03T04:00:00Z"),
      expect.objectContaining({
      provider: "fake",
      providerTaskId: "request-1",
      transcript: "transcript",
      claimedAt: null,
      expiresAt: new Date("2026-08-10T04:00:00Z"),
      }),
    );
  });

  it("does not call the provider when the lease cannot be claimed", async () => {
    const adapter = { provider: "fake", transcribe: vi.fn() };
    await expect(runTranscription("recording-1", {
      repository: { claim: async () => null, complete: vi.fn(), fail: vi.fn() },
      adapter,
      resolvePath: vi.fn(),
    })).rejects.toThrow(/无法抢占/);
    expect(adapter.transcribe).not.toHaveBeenCalled();
  });

  it("persists only a sanitized provider failure", async () => {
    const fail = vi.fn(async () => {});
    await expect(runTranscription("recording-1", {
      repository: { claim: async () => claimed, complete: vi.fn(), fail },
      adapter: {
        provider: "tencent-flash",
        transcribe: async () => { throw new TencentTranscriptionError("TENCENT_4006", "腾讯云转写失败（4006）"); },
      },
      resolvePath: async () => "/private/secret/path.wav",
    })).rejects.toThrow(/4006/);
    expect(fail).toHaveBeenCalledWith("recording-1", claimed.claimedAt, {
      errorCode: "TENCENT_4006",
      errorNote: "腾讯云转写失败（4006）",
      claimedAt: null,
    });
    expect(JSON.stringify(fail.mock.calls)).not.toContain("/private/secret/path.wav");
  });
});

describe("runTranscriptionMaintenance", () => {
  it("recovers expired leases before advancing stale uploaded recordings", async () => {
    const calls: string[] = [];
    const repository = {
      claimStaleUploads: vi.fn(async () => []),
      completeUploadCleanup: vi.fn(async () => {}),
      failUploadCleanup: vi.fn(async () => {}),
      recoverExpired: vi.fn(async () => { calls.push("recover"); return 2; }),
      listStaleUploaded: vi.fn(async () => { calls.push("list"); return ["a", "b"]; }),
    };
    const transcribe = vi.fn(async (id: string) => { calls.push(id); });
    await expect(runTranscriptionMaintenance({ repository, remove: vi.fn(), transcribe, now: () => new Date("2026-08-03T04:00:00Z"), leaseMinutes: 30 }))
      .resolves.toEqual({ uploadCleanupClaimed: 0, uploadCleanupDeleted: 0, uploadCleanupFailed: 0, recovered: 2, advanced: 2, failed: 0 });
    expect(calls).toEqual(["recover", "list", "a", "b"]);
  });

  it("continues after one stale recording fails", async () => {
    const repository = {
      claimStaleUploads: async () => [], completeUploadCleanup: async () => {}, failUploadCleanup: async () => {},
      recoverExpired: async () => 0, listStaleUploaded: async () => ["a", "b"],
    };
    const transcribe = vi.fn(async (id: string) => { if (id === "a") throw new Error("provider body secret"); });
    await expect(runTranscriptionMaintenance({ repository, remove: vi.fn(), transcribe }))
      .resolves.toEqual({ uploadCleanupClaimed: 0, uploadCleanupDeleted: 0, uploadCleanupFailed: 0, recovered: 0, advanced: 1, failed: 1 });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("reclaims stale uploading reservations and retains cleanup failures for retry", async () => {
    const fence = new Date("2026-08-03T04:00:00Z");
    const repository = {
      claimStaleUploads: vi.fn(async () => [
        { id: "partial", storagePath: "recording-one/audio.wav", claimedAt: fence },
        { id: "retry", storagePath: "recording-two/audio.wav", claimedAt: fence },
      ]),
      completeUploadCleanup: vi.fn(async () => {}),
      failUploadCleanup: vi.fn(async () => {}),
      recoverExpired: vi.fn(async () => 0),
      listStaleUploaded: vi.fn(async () => []),
    };
    const remove = vi.fn(async (storagePath: string) => {
      if (storagePath.includes("two")) throw new Error("cannot remove /private/secret.wav");
    });
    await expect(runTranscriptionMaintenance({ repository, remove, transcribe: vi.fn(), now: () => fence, leaseMinutes: 30 }))
      .resolves.toEqual({ uploadCleanupClaimed: 2, uploadCleanupDeleted: 1, uploadCleanupFailed: 1, recovered: 0, advanced: 0, failed: 0 });
    expect(repository.completeUploadCleanup).toHaveBeenCalledWith("partial", fence);
    expect(repository.failUploadCleanup).toHaveBeenCalledWith("retry", fence);
    expect(JSON.stringify(repository.failUploadCleanup.mock.calls)).not.toContain("/private/secret.wav");
  });
});
