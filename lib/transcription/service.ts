import "server-only";

import { AUDIO_MAX_DURATION_SEC } from "./policy";
import { TencentTranscriptionError } from "./tencent";
import type { AudioVoiceFormat, TranscriptionAdapter, TranscriptionResult } from "./types";

export type ClaimedRecording = {
  id: string;
  claimedAt: Date;
  bytes: number;
  storagePath: string;
  mimeType: string;
  originalName: string;
};

export type TranscriptionRepository = {
  claim(id: string, now: Date, leaseMinutes: number): Promise<ClaimedRecording | null>;
  complete(id: string, claimedAt: Date, data: {
    provider: string;
    providerTaskId: string;
    transcript: string;
    transcriptSegments: TranscriptionResult["segments"];
    durationSec: number;
    expiresAt: Date;
    claimedAt: null;
  }): Promise<void>;
  fail(id: string, claimedAt: Date, data: { errorCode: string; errorNote: string; claimedAt: null }): Promise<void>;
};

function voiceFormat(name: string): AudioVoiceFormat {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "m4a" || extension === "mp3" || extension === "wav" || extension === "aac") {
    return extension;
  }
  throw new Error("录音格式不受支持");
}

function sanitizedFailure(error: unknown) {
  if (error instanceof TencentTranscriptionError) {
    return { errorCode: error.code, errorNote: error.message };
  }
  return { errorCode: "TRANSCRIPTION_FAILED", errorNote: "转写失败，请稍后重试" };
}

export async function runTranscription(
  id: string,
  options: {
    repository: TranscriptionRepository;
    adapter: TranscriptionAdapter;
    resolvePath: (storagePath: string) => Promise<string>;
    now?: () => Date;
    leaseMinutes?: number;
  },
): Promise<{ status: "TRANSCRIBED" }> {
  const now = options.now?.() ?? new Date();
  const claimed = await options.repository.claim(id, now, options.leaseMinutes ?? 30);
  if (!claimed) throw new Error("录音无法抢占，可能正在转写或已被关闭");

  try {
    const path = await options.resolvePath(claimed.storagePath);
    const result = await options.adapter.transcribe({
      path,
      bytes: claimed.bytes,
      voiceFormat: voiceFormat(claimed.originalName),
    });
    if (result.durationSec > AUDIO_MAX_DURATION_SEC) throw new Error("转写结果时长超过 2 小时");
    await options.repository.complete(id, claimed.claimedAt, {
      provider: options.adapter.provider,
      providerTaskId: result.providerTaskId,
      transcript: result.transcript,
      transcriptSegments: result.segments,
      durationSec: result.durationSec,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
      claimedAt: null,
    });
    return { status: "TRANSCRIBED" };
  } catch (error) {
    await options.repository.fail(id, claimed.claimedAt, { ...sanitizedFailure(error), claimedAt: null });
    throw error;
  }
}

type MaintenanceRepository = {
  claimStaleUploads(now: Date, leaseMinutes: number): Promise<UploadCleanupClaim[]>;
  completeUploadCleanup(id: string, claimedAt: Date): Promise<void>;
  failUploadCleanup(id: string, claimedAt: Date): Promise<void>;
  recoverExpired(now: Date, leaseMinutes: number): Promise<number>;
  listStaleUploaded(now: Date): Promise<string[]>;
};

export type UploadCleanupClaim = {
  id: string;
  storagePath: string;
  claimedAt: Date;
};

export async function runTranscriptionMaintenance(options: {
  repository: MaintenanceRepository;
  remove: (storagePath: string) => Promise<void>;
  transcribe: (id: string) => Promise<unknown>;
  now?: () => Date;
  leaseMinutes?: number;
}) {
  const now = options.now?.() ?? new Date();
  const leaseMinutes = options.leaseMinutes ?? 30;
  const cleanupClaims = await options.repository.claimStaleUploads(now, leaseMinutes);
  let uploadCleanupDeleted = 0;
  let uploadCleanupFailed = 0;
  for (const claim of cleanupClaims) {
    try {
      await options.remove(claim.storagePath);
      await options.repository.completeUploadCleanup(claim.id, claim.claimedAt);
      uploadCleanupDeleted += 1;
    } catch {
      await options.repository.failUploadCleanup(claim.id, claim.claimedAt).catch(() => {});
      uploadCleanupFailed += 1;
    }
  }
  const recovered = await options.repository.recoverExpired(now, leaseMinutes);
  const stale = await options.repository.listStaleUploaded(now);
  let advanced = 0;
  let failed = 0;
  for (const id of stale) {
    try {
      await options.transcribe(id);
      advanced += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    uploadCleanupClaimed: cleanupClaims.length,
    uploadCleanupDeleted,
    uploadCleanupFailed,
    recovered,
    advanced,
    failed,
  };
}
