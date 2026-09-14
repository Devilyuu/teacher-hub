import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { audioVoiceFormat, probeAudioMetadata } from "./audio-metadata";

const path = join(tmpdir(), `teacher-desk-duration-${process.pid}.wav`);

function oneSecondWav(): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

afterEach(async () => rm(path, { force: true }));

describe("audio metadata", () => {
  it("reads real duration, container, codec, and voice format", async () => {
    await writeFile(path, oneSecondWav());
    await expect(probeAudioMetadata(path)).resolves.toEqual({
      durationSec: 1,
      container: "WAVE",
      codec: "PCM",
      voiceFormat: "wav",
    });
  });

  it.each([
    ["WAVE", "PCM", "wav"],
    ["MPEG", "MPEG 1 Layer 3", "mp3"],
    ["M4A/isom/mp42", "MPEG-4/AAC", "m4a"],
    ["ADTS/MPEG-4", "AAC", "aac"],
  ] as const)("maps music-metadata %s / %s to %s", (container, codec, expected) => {
    expect(audioVoiceFormat({ container, codec })).toBe(expected);
  });

  it.each([
    ["WAVE", "MPEGLAYER3"],
    ["isom/mp42", "MPEG-4/AAC"],
    ["unknown", "unknown"],
  ])("fails closed for unknown container/codec %s / %s", (container, codec) => {
    expect(() => audioVoiceFormat({ container, codec })).toThrow(/无法确认音频真实格式/);
  });

  it("fails closed when duration cannot be proven", async () => {
    await writeFile(path, Buffer.from("not audio"));
    await expect(probeAudioMetadata(path)).rejects.toThrow(/无法读取音频元数据/);
  });
});
