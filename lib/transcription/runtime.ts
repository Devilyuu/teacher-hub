import "server-only";

import { statfs } from "node:fs/promises";
import { minutesAdapterFromEnv } from "@/lib/minutes/adapter";
import { removeRecordingAudio, runMinutesCleanupMaintenance } from "@/lib/minutes/cleanup";
import {
  confirmRecordingMinutes,
  generateRecordingMinutes,
  initializeManualMinutesDraft,
  saveRecordingMinutesDraft,
} from "@/lib/minutes/service";
import { probeAudioMetadata } from "./audio-metadata";
import { createFakeTranscriptionAdapter } from "./fake";
import { audioPolicyFromEnv } from "./policy";
import { runTranscription, runTranscriptionMaintenance } from "./service";
import {
  createRecordingStoragePath,
  ensureAudioTempRoot,
  removeRecordingFile,
  resolveAudioTempRoot,
  resolveRecordingFile,
  writeRecordingFile,
} from "./storage";
import { tencentAdapterFromEnv } from "./tencent";
import type { TranscriptionAdapter } from "./types";
import { uploadMeetingRecording } from "./upload";

type Env = Record<string, string | undefined>;

export function selectTranscriptionAdapter(env: Env = process.env): TranscriptionAdapter {
  if (env.TRANSCRIPTION_ADAPTER === "fake") return createFakeTranscriptionAdapter();
  if (!env.TENCENT_ASR_APP_ID || !env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
    throw new Error("腾讯云转写尚未配置，请先在设置页完成配置");
  }
  return tencentAdapterFromEnv(env);
}

export function selectMinutesGenerationAdapter(env: Env = process.env) {
  return minutesAdapterFromEnv(env);
}

async function dependencies(env: Env = process.env) {
  const [{ prisma }, { UPLOAD_ROOT }, { createPrismaTranscriptionRepository }, { createPrismaMinutesRepository }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/storage"),
    import("./prisma-repository"),
    import("@/lib/minutes/prisma-repository"),
  ]);
  const root = resolveAudioTempRoot(env.AUDIO_TEMP_ROOT?.trim() || undefined, { uploadRoot: UPLOAD_ROOT });
  await ensureAudioTempRoot(root);
  return {
    repository: createPrismaTranscriptionRepository(prisma),
    minutesRepository: createPrismaMinutesRepository(prisma),
    root,
    policy: audioPolicyFromEnv(env),
  };
}

export async function uploadRecordingWithRuntime(
  meetingId: string,
  file: File,
  cloudDisclosureAccepted: boolean,
) {
  const { repository, root, policy } = await dependencies();
  return uploadMeetingRecording(meetingId, file, cloudDisclosureAccepted, {
    ...repository,
    quotaBytes: policy.quotaBytes,
    async availableBytes() {
      const stats = await statfs(root);
      return stats.bavail * stats.bsize;
    },
    createStoragePath: createRecordingStoragePath,
    write: (candidate, storagePath) => writeRecordingFile(candidate, storagePath, root),
    probeMetadata: probeAudioMetadata,
    remove: (storagePath) => removeRecordingFile(storagePath, root),
  });
}

export async function transcribeRecordingWithRuntime(id: string) {
  const { repository, root, policy } = await dependencies();
  return runTranscription(id, {
    repository,
    adapter: selectTranscriptionAdapter(),
    resolvePath: (storagePath) => resolveRecordingFile(storagePath, root),
    leaseMinutes: policy.leaseMinutes,
  });
}

export async function initializeManualMinutesWithRuntime(id: string) {
  const { minutesRepository } = await dependencies();
  return initializeManualMinutesDraft(id, minutesRepository);
}

export async function generateMinutesWithRuntime(id: string) {
  const { minutesRepository } = await dependencies();
  return generateRecordingMinutes(id, {
    repository: minutesRepository,
    adapter: selectMinutesGenerationAdapter(),
  });
}

export async function saveMinutesDraftWithRuntime(id: string, input: unknown) {
  const { minutesRepository } = await dependencies();
  return saveRecordingMinutesDraft(id, input, minutesRepository);
}

export async function removeRecordingAudioWithRuntime(id: string) {
  const { minutesRepository, root, policy } = await dependencies();
  return removeRecordingAudio(id, {
    repository: minutesRepository,
    remove: (storagePath) => removeRecordingFile(storagePath, root),
    leaseMinutes: policy.leaseMinutes,
  });
}

export async function confirmMinutesWithRuntime(id: string, draft: unknown) {
  const { minutesRepository, root, policy } = await dependencies();
  return confirmRecordingMinutes(id, draft, {
    repository: minutesRepository,
    removeAudio: (recordingId) => removeRecordingAudio(recordingId, {
      repository: minutesRepository,
      remove: (storagePath) => removeRecordingFile(storagePath, root),
      leaseMinutes: policy.leaseMinutes,
    }),
  });
}

export async function maintainTranscriptionWithRuntime() {
  const { repository, minutesRepository, policy, root } = await dependencies();
  const transcription = await runTranscriptionMaintenance({
    repository,
    leaseMinutes: policy.leaseMinutes,
    remove: (storagePath) => removeRecordingFile(storagePath, root),
    transcribe: transcribeRecordingWithRuntime,
  });
  const minutesCleanup = await runMinutesCleanupMaintenance({
    repository: minutesRepository,
    leaseMinutes: policy.leaseMinutes,
    remove: (storagePath) => removeRecordingFile(storagePath, root),
  });
  return { ...transcription, ...minutesCleanup };
}
