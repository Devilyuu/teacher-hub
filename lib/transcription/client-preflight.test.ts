import { describe, expect, it, vi } from "vitest";
import {
  preflightClientAudio,
  probeBrowserAudioDuration,
  validateClientAudioFile,
} from "./client-preflight";

const validFile = new File([new Uint8Array(16)], "meeting.wav", { type: "audio/wav" });

describe("client audio preflight", () => {
  it("rejects an oversized file before any upload request", () => {
    const oversized = { name: "meeting.wav", type: "audio/wav", size: 100 * 1024 * 1024 + 1 };
    expect(validateClientAudioFile(oversized)).toMatch(/100MB/);
  });

  it.each([
    ["meeting.m4a", "audio/x-m4a"],
    ["meeting.m4a", "video/mp4"],
    ["meeting.wav", "audio/wave"],
    ["meeting.aac", "audio/x-aac"],
    ["meeting.aac", "audio/vnd.dlna.adts"],
  ])("accepts every server-approved format pair: %s / %s", (name, type) => {
    expect(validateClientAudioFile({ name, type, size: 16 })).toBeNull();
  });

  it("rejects browser-readable audio longer than two hours", async () => {
    await expect(preflightClientAudio(validFile, async () => 7200.01)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/2 小时/),
    });
  });

  it("defers duration validation to the server when browser metadata is unavailable", async () => {
    await expect(preflightClientAudio(validFile, async () => null)).resolves.toEqual({ ok: true });
    await expect(preflightClientAudio(validFile, async () => { throw new Error("codec unavailable"); }))
      .resolves.toEqual({ ok: true });
  });

  it("loads browser metadata and always revokes the object URL", async () => {
    const revokeObjectURL = vi.fn();
    const audio = { duration: 61, preload: "", src: "", onloadedmetadata: null, onerror: null } as {
      duration: number;
      preload: string;
      src: string;
      onloadedmetadata: null | (() => void);
      onerror: null | (() => void);
    };
    const result = probeBrowserAudioDuration(validFile, {
      createObjectURL: () => "blob:audio",
      revokeObjectURL,
      createAudio: () => audio,
      setTimer: (callback) => { audio.onloadedmetadata?.(); callback(); return 1; },
      clearTimer: vi.fn(),
    });
    await expect(result).resolves.toBe(61);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });
});
