import "server-only";

import { AUDIO_MAX_DURATION_SEC, assertAudioUploadAllowed } from "./policy";
import type { AudioVoiceFormat } from "./types";

type UploadDependencies = {
  getMeeting(id: string): Promise<{ id: string; transcriptionEnabled: boolean } | null>;
  createStoragePath(originalName: string): string;
  reserve(meetingId: string, data: {
    source: "UPLOAD";
    originalName: string;
    mimeType: string;
    bytes: number;
    storagePath: string;
    cloudConsentAt: Date | null;
    quotaBytes: number;
  }): Promise<{ id: string; claimedAt: Date }>;
  finalize(id: string, claimedAt: Date, data: { durationSec: number }): Promise<void>;
  discard(id: string, claimedAt: Date): Promise<void>;
  availableBytes(): Promise<number>;
  write(file: File, storagePath: string): Promise<{ absolutePath: string }>;
  probeMetadata(path: string): Promise<{ durationSec: number; voiceFormat: AudioVoiceFormat }>;
  remove(storagePath: string): Promise<void>;
  quotaBytes: number;
};

export async function uploadMeetingRecording(
  meetingId: string,
  file: File,
  cloudDisclosureAccepted: boolean,
  deps: UploadDependencies,
): Promise<{ id: string; status: "UPLOADED" }> {
  const meeting = await deps.getMeeting(meetingId);
  if (!meeting) throw new Error("会议不存在");
  if (meeting.transcriptionEnabled && !cloudDisclosureAccepted) {
    throw new Error("请先确认音频将上传到腾讯云做转写");
  }

  const availableBytes = await deps.availableBytes();
  const declared = assertAudioUploadAllowed({
    name: file.name,
    mimeType: file.type,
    bytes: file.size,
    durationSec: 1,
    existingBytes: 0,
    availableBytes,
    quotaBytes: Number.MAX_SAFE_INTEGER,
  });

  // The path is random but allocation-free, so quota reservation can persist
  // the exact cleanup target before the first byte is written.
  const storagePath = deps.createStoragePath(file.name);
  const recording = await deps.reserve(meetingId, {
    source: "UPLOAD",
    originalName: file.name,
    mimeType: file.type,
    bytes: file.size,
    storagePath,
    cloudConsentAt: cloudDisclosureAccepted ? new Date() : null,
    quotaBytes: deps.quotaBytes,
  });
  try {
    const saved = await deps.write(file, storagePath);
    const metadata = await deps.probeMetadata(saved.absolutePath);
    if (metadata.voiceFormat !== declared.voiceFormat) {
      throw new Error("音频内容格式与扩展名不一致");
    }
    const durationSec = metadata.durationSec;
    if (durationSec <= 0 || durationSec > AUDIO_MAX_DURATION_SEC) {
      throw new Error("音频时长不能超过 2 小时");
    }
    await deps.finalize(recording.id, recording.claimedAt, { durationSec });
    return { id: recording.id, status: "UPLOADED" };
  } catch (error) {
    // Keep the reservation when disk cleanup fails. Maintenance can retry it
    // after the upload lease expires, without leaking the storage path.
    try {
      await deps.remove(storagePath);
      await deps.discard(recording.id, recording.claimedAt);
    } catch {
      // Preserve the original upload/metadata failure for the client.
    }
    throw error;
  }
}
