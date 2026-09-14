import "server-only";

import { parseFile } from "music-metadata";
import type { AudioVoiceFormat } from "./types";

type DetectedFormat = { container?: string; codec?: string };

export function audioVoiceFormat(format: DetectedFormat): AudioVoiceFormat {
  const container = format.container ?? "";
  const codec = format.codec ?? "";
  if (container === "WAVE" && codec === "PCM") return "wav";
  if (container === "MPEG" && /^MPEG (?:1|2|2\.5) Layer 3$/.test(codec)) return "mp3";
  if (container.split("/").includes("M4A") && codec === "MPEG-4/AAC") return "m4a";
  if (/^ADTS\/MPEG-(?:2|4)$/.test(container) && codec === "AAC") return "aac";
  throw new Error("无法确认音频真实格式");
}

export async function probeAudioMetadata(path: string): Promise<{
  durationSec: number;
  container: string;
  codec: string;
  voiceFormat: AudioVoiceFormat;
}> {
  try {
    const metadata = await parseFile(path, { duration: true, skipCovers: true });
    const duration = metadata.format.duration;
    const container = metadata.format.container;
    const codec = metadata.format.codec;
    if (!duration || !Number.isFinite(duration) || duration <= 0 || !container || !codec) {
      throw new Error("missing metadata");
    }
    return {
      durationSec: Math.ceil(duration),
      container,
      codec,
      voiceFormat: audioVoiceFormat({ container, codec }),
    };
  } catch {
    throw new Error("无法读取音频元数据，请确认文件未损坏且格式正确");
  }
}
