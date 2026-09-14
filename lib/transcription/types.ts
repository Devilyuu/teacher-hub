export type AudioVoiceFormat = "m4a" | "mp3" | "wav" | "aac";

export type TranscriptSegment = {
  text: string;
  startMs: number;
  endMs: number;
  speakerId: number | null;
};

export type TranscriptionResult = {
  providerTaskId: string;
  durationSec: number;
  transcript: string;
  segments: TranscriptSegment[];
};

export type TranscriptionAdapter = {
  provider: string;
  transcribe(input: { path: string; bytes: number; voiceFormat: AudioVoiceFormat }): Promise<TranscriptionResult>;
};
