import { describe, expect, it } from "vitest";
import { createFakeTranscriptionAdapter } from "./fake";

describe("fake transcription adapter", () => {
  it("returns deterministic transcript data without reading credentials", async () => {
    const adapter = createFakeTranscriptionAdapter();
    await expect(adapter.transcribe({ path: "ignored.mp3", bytes: 12, voiceFormat: "mp3" }))
      .resolves.toMatchObject({
        providerTaskId: "fake-12-mp3",
        durationSec: 1,
        transcript: "假转写：会议录音已处理。",
      });
  });
});
