export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_MAX_DURATION_SEC = 2 * 60 * 60;
export const AUDIO_DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const AUDIO_DISK_RESERVE_BYTES = 1024 * 1024 * 1024;

export const AUDIO_FORMATS = {
  m4a: ["audio/mp4", "audio/x-m4a", "video/mp4"],
  mp3: ["audio/mpeg", "audio/mp3"],
  wav: ["audio/wav", "audio/x-wav", "audio/wave"],
  aac: ["audio/aac", "audio/x-aac", "audio/vnd.dlna.adts"],
} as const;

type UploadCandidate = {
  name: string;
  mimeType: string;
  bytes: number;
  durationSec: number;
  existingBytes: number;
  availableBytes: number;
  quotaBytes: number;
};

export function assertAudioUploadAllowed(candidate: UploadCandidate): { voiceFormat: string } {
  const extension = candidate.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const allowedMimes = extension ? AUDIO_FORMATS[extension as keyof typeof AUDIO_FORMATS] : undefined;
  if (!extension || !allowedMimes) throw new Error("只支持 m4a、mp3、wav、aac 音频");
  if (!(allowedMimes as readonly string[]).includes(candidate.mimeType.toLowerCase())) throw new Error("音频格式与扩展名不一致");
  if (!Number.isSafeInteger(candidate.bytes) || candidate.bytes <= 0 || candidate.bytes > AUDIO_MAX_BYTES) {
    throw new Error("单个音频不能超过 100MB");
  }
  if (!Number.isFinite(candidate.durationSec) || candidate.durationSec <= 0
    || candidate.durationSec > AUDIO_MAX_DURATION_SEC) {
    throw new Error("音频时长不能超过 2 小时");
  }
  if (candidate.existingBytes + candidate.bytes > candidate.quotaBytes) {
    throw new Error("录音总量已满，请先确认或删除既有录音");
  }
  const requiredFree = candidate.bytes * 3 + AUDIO_DISK_RESERVE_BYTES;
  if (candidate.availableBytes < requiredFree) {
    throw new Error("录音目录磁盘空间不足，请先确认或删除既有录音");
  }
  return { voiceFormat: extension };
}

function positiveInteger(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

export function audioPolicyFromEnv(env: Record<string, string | undefined> = process.env) {
  return {
    quotaBytes: positiveInteger(env, "AUDIO_QUOTA_BYTES", AUDIO_DEFAULT_QUOTA_BYTES),
    leaseMinutes: positiveInteger(env, "TRANSCRIPTION_LEASE_MINUTES", 30),
  };
}

export function isLeaseAvailable(claimedAt: Date | null, now: Date, leaseMinutes: number): boolean {
  return claimedAt == null || claimedAt.getTime() <= now.getTime() - leaseMinutes * 60_000;
}

type MaintenanceRecording = {
  status: string;
  claimedAt: Date | null;
  createdAt: Date;
};

export function maintenanceAction(
  recording: MaintenanceRecording,
  now: Date,
  leaseMinutes: number,
): "RECOVER_LEASE" | "TRANSCRIBE" | "NONE" {
  if (recording.status === "TRANSCRIBING" && isLeaseAvailable(recording.claimedAt, now, leaseMinutes)) {
    return "RECOVER_LEASE";
  }
  if (recording.status === "UPLOADED" && recording.createdAt.getTime() <= now.getTime() - 10 * 60_000) {
    return "TRANSCRIBE";
  }
  return "NONE";
}
