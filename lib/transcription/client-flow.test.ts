import { describe, expect, it, vi } from "vitest";
import { uploadThenMaybeTranscribe } from "./client-flow";

describe("uploadThenMaybeTranscribe", () => {
  it("keeps upload success distinct when Tencent ASR is unconfigured", async () => {
    const transcribe = vi.fn();
    await expect(uploadThenMaybeTranscribe({
      upload: async () => ({ id: "recording-1" }),
      transcribe,
      transcriptionEnabled: true,
      asrConfigured: false,
    })).resolves.toMatchObject({ uploaded: true, transcription: "unconfigured", notice: expect.stringMatching(/已上传.*尚未配置/) });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("keeps upload success distinct when immediate transcription fails", async () => {
    await expect(uploadThenMaybeTranscribe({
      upload: async () => ({ id: "recording-1" }),
      transcribe: async () => { throw new Error("provider unavailable"); },
      transcriptionEnabled: true,
      asrConfigured: true,
    })).resolves.toMatchObject({ uploaded: true, transcription: "failed", notice: expect.stringMatching(/已上传.*转写失败/) });
  });
});
