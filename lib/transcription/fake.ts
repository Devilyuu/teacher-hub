import type { TranscriptionAdapter } from "./types";

export function createFakeTranscriptionAdapter(): TranscriptionAdapter {
  return {
    provider: "fake",
    async transcribe(input) {
      return {
        providerTaskId: `fake-${input.bytes}-${input.voiceFormat}`,
        durationSec: 1,
        transcript: "假转写：会议录音已处理。",
        segments: [{ text: "假转写：会议录音已处理。", startMs: 0, endMs: 1000, speakerId: 0 }],
      };
    },
  };
}
