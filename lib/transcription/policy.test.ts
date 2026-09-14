import { describe, expect, it } from "vitest";
import {
  AUDIO_MAX_BYTES,
  AUDIO_MAX_DURATION_SEC,
  assertAudioUploadAllowed,
  audioPolicyFromEnv,
  isLeaseAvailable,
  maintenanceAction,
} from "./policy";

const GiB = 1024 ** 3;

describe("audio upload policy", () => {
  it.each([
    ["meeting.m4a", "audio/mp4", "m4a"],
    ["meeting.mp3", "audio/mpeg", "mp3"],
    ["meeting.wav", "audio/wav", "wav"],
    ["meeting.aac", "audio/aac", "aac"],
  ])("accepts the approved extension and MIME pair %s", (name, mimeType, voiceFormat) => {
    expect(assertAudioUploadAllowed({
      name,
      mimeType,
      bytes: 1024,
      durationSec: 60,
      existingBytes: 0,
      availableBytes: 2 * GiB,
      quotaBytes: 2 * GiB,
    })).toEqual({ voiceFormat });
  });

  it("rejects unsupported or mismatched formats", () => {
    const base = {
      bytes: 1024,
      durationSec: 60,
      existingBytes: 0,
      availableBytes: 2 * GiB,
      quotaBytes: 2 * GiB,
    };
    expect(() => assertAudioUploadAllowed({ ...base, name: "meeting.webm", mimeType: "audio/webm" }))
      .toThrow(/m4a.*mp3.*wav.*aac/i);
    expect(() => assertAudioUploadAllowed({ ...base, name: "meeting.mp3", mimeType: "audio/wav" }))
      .toThrow(/格式与扩展名不一致/);
  });

  it("enforces 100MB, two hours, total quota, and triple-space plus 1GiB", () => {
    const base = {
      name: "meeting.wav",
      mimeType: "audio/wav",
      bytes: 1024,
      durationSec: 60,
      existingBytes: 0,
      availableBytes: 2 * GiB,
      quotaBytes: 2 * GiB,
    };
    expect(() => assertAudioUploadAllowed({ ...base, bytes: AUDIO_MAX_BYTES + 1 })).toThrow(/100MB/);
    expect(() => assertAudioUploadAllowed({ ...base, durationSec: AUDIO_MAX_DURATION_SEC + 1 })).toThrow(/2 小时/);
    expect(() => assertAudioUploadAllowed({ ...base, existingBytes: 2 * GiB })).toThrow(/先确认或删除既有录音/);
    expect(() => assertAudioUploadAllowed({ ...base, availableBytes: GiB + 3 * 1024 - 1 })).toThrow(/磁盘空间不足/);
  });

  it("uses bounded environment defaults", () => {
    expect(audioPolicyFromEnv({})).toMatchObject({ quotaBytes: 2 * GiB, leaseMinutes: 30 });
    expect(() => audioPolicyFromEnv({ AUDIO_QUOTA_BYTES: "0" })).toThrow(/AUDIO_QUOTA_BYTES/);
    expect(() => audioPolicyFromEnv({ TRANSCRIPTION_LEASE_MINUTES: "not-a-number" })).toThrow(/LEASE/);
  });
});

describe("recording lease and maintenance policy", () => {
  const now = new Date("2026-08-03T04:00:00.000Z");

  it("only lets a missing or expired lease be claimed", () => {
    expect(isLeaseAvailable(null, now, 30)).toBe(true);
    expect(isLeaseAvailable(new Date("2026-08-03T03:29:59.999Z"), now, 30)).toBe(true);
    expect(isLeaseAvailable(new Date("2026-08-03T03:45:00.000Z"), now, 30)).toBe(false);
  });

  it("recovers expired work and advances stale uploaded recordings", () => {
    expect(maintenanceAction({ status: "TRANSCRIBING", claimedAt: new Date("2026-08-03T03:00:00Z"), createdAt: now }, now, 30))
      .toBe("RECOVER_LEASE");
    expect(maintenanceAction({ status: "UPLOADED", claimedAt: null, createdAt: new Date("2026-08-03T03:49:59Z") }, now, 30))
      .toBe("TRANSCRIBE");
    expect(maintenanceAction({ status: "UPLOADED", claimedAt: null, createdAt: new Date("2026-08-03T03:55:00Z") }, now, 30))
      .toBe("NONE");
  });
});
