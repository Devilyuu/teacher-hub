import { describe, expect, it, vi } from "vitest";
import { uploadMeetingRecording } from "./upload";

function deps(overrides = {}) {
  const claimedAt = new Date("2026-08-03T04:00:00Z");
  return {
    getMeeting: vi.fn(async () => ({ id: "meeting-1", transcriptionEnabled: true })),
    createStoragePath: vi.fn(() => "recording-11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.wav"),
    reserve: vi.fn(async () => ({ id: "recording-1", claimedAt })),
    finalize: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    availableBytes: vi.fn(async () => 3 * 1024 ** 3),
    write: vi.fn(async () => ({ absolutePath: "/private/audio.wav" })),
    probeMetadata: vi.fn(async () => ({ durationSec: 60, voiceFormat: "wav" as const })),
    remove: vi.fn(async () => {}),
    quotaBytes: 2 * 1024 ** 3,
    ...overrides,
  };
}

const file = () => new File([Buffer.alloc(1024)], "meeting.wav", { type: "audio/wav" });

describe("uploadMeetingRecording", () => {
  it("requires a fresh cloud disclosure acknowledgement when transcription is enabled", async () => {
    const options = deps();
    await expect(uploadMeetingRecording("meeting-1", file(), false, options)).rejects.toThrow(/上传到腾讯云/);
    expect(options.reserve).not.toHaveBeenCalled();
    expect(options.write).not.toHaveBeenCalled();
  });

  it("reserves quota before writing and finalizes an uploaded recording", async () => {
    const calls: string[] = [];
    const options = deps({
      createStoragePath: vi.fn(() => { calls.push("path"); return "recording-safe/audio.wav"; }),
      reserve: vi.fn(async () => { calls.push("reserve"); return { id: "recording-1", claimedAt: new Date("2026-08-03T04:00:00Z") }; }),
      write: vi.fn(async () => { calls.push("write"); return { absolutePath: "/private/audio.wav" }; }),
      finalize: vi.fn(async () => { calls.push("finalize"); }),
    });
    await expect(uploadMeetingRecording("meeting-1", file(), true, options)).resolves.toEqual({
      id: "recording-1",
      status: "UPLOADED",
    });
    expect(calls).toEqual(["path", "reserve", "write", "finalize"]);
    expect(options.finalize).toHaveBeenCalledWith("recording-1", new Date("2026-08-03T04:00:00Z"), {
      durationSec: 60,
    });
    expect(options.reserve).toHaveBeenCalledWith("meeting-1", expect.objectContaining({
      cloudConsentAt: expect.any(Date),
      storagePath: "recording-safe/audio.wav",
    }));
  });

  it("allows local-only upload without cloud acknowledgement", async () => {
    const options = deps({
      getMeeting: vi.fn(async () => ({ id: "meeting-1", transcriptionEnabled: false })),
    });
    await expect(uploadMeetingRecording("meeting-1", file(), false, options)).resolves.toMatchObject({ status: "UPLOADED" });
    expect(options.reserve).toHaveBeenCalledWith("meeting-1", expect.objectContaining({ cloudConsentAt: null }));
  });

  it("compensates both the reservation and private file when metadata validation fails", async () => {
    const options = deps({ probeMetadata: vi.fn(async () => { throw new Error("bad audio"); }) });
    await expect(uploadMeetingRecording("meeting-1", file(), true, options)).rejects.toThrow("bad audio");
    expect(options.remove).toHaveBeenCalledWith(expect.stringContaining("recording-"));
    expect(options.discard).toHaveBeenCalledWith("recording-1", new Date("2026-08-03T04:00:00Z"));
  });

  it("rejects approved extension and MIME when the actual audio content differs", async () => {
    const options = deps({
      probeMetadata: vi.fn(async () => ({ durationSec: 60, voiceFormat: "mp3" as const })),
    });
    await expect(uploadMeetingRecording("meeting-1", file(), true, options))
      .rejects.toThrow(/音频内容格式与扩展名不一致/);
    expect(options.finalize).not.toHaveBeenCalled();
    expect(options.remove).toHaveBeenCalled();
    expect(options.discard).toHaveBeenCalled();
  });

  it("retains the fenced reservation when partial-file cleanup fails", async () => {
    const options = deps({
      write: vi.fn(async () => { throw new Error("disk write failed"); }),
      remove: vi.fn(async () => { throw new Error("cleanup failed /private/audio.wav"); }),
    });
    await expect(uploadMeetingRecording("meeting-1", file(), true, options)).rejects.toThrow("disk write failed");
    expect(options.discard).not.toHaveBeenCalled();
  });
});
