import "server-only";

export type AudioDeletionClaim = {
  id: string;
  storagePath: string;
  claimedAt: Date;
};

export type AudioCleanupRepository = {
  claimAudioDeletion(id: string, now: Date, leaseMinutes: number): Promise<AudioDeletionClaim | null>;
  claimDueAudioDeletions(now: Date, leaseMinutes: number, limit: number): Promise<AudioDeletionClaim[]>;
  completeAudioDeletion(id: string, claimedAt: Date, deletedAt: Date): Promise<void>;
  failAudioDeletion(id: string, claimedAt: Date): Promise<void>;
};

export async function removeRecordingAudio(
  id: string,
  options: {
    repository: AudioCleanupRepository;
    remove: (storagePath: string) => Promise<void>;
    now?: () => Date;
    leaseMinutes?: number;
  },
): Promise<{ status: "AUDIO_DELETED" }> {
  const now = options.now?.() ?? new Date();
  const claim = await options.repository.claimAudioDeletion(id, now, options.leaseMinutes ?? 30);
  if (!claim) throw new Error("音频正在删除或已经删除");
  try {
    await options.remove(claim.storagePath);
    await options.repository.completeAudioDeletion(claim.id, claim.claimedAt, now);
    return { status: "AUDIO_DELETED" };
  } catch {
    await options.repository.failAudioDeletion(claim.id, claim.claimedAt).catch(() => {});
    throw new Error("音频删除失败，已进入维护重试队列");
  }
}

export async function runMinutesCleanupMaintenance(options: {
  repository: AudioCleanupRepository;
  remove: (storagePath: string) => Promise<void>;
  now?: () => Date;
  leaseMinutes?: number;
  limit?: number;
}) {
  const now = options.now?.() ?? new Date();
  const claims = await options.repository.claimDueAudioDeletions(
    now,
    options.leaseMinutes ?? 30,
    options.limit ?? 20,
  );
  let audioDeleted = 0;
  let audioDeleteFailed = 0;
  for (const claim of claims) {
    try {
      await options.remove(claim.storagePath);
      await options.repository.completeAudioDeletion(claim.id, claim.claimedAt, now);
      audioDeleted += 1;
    } catch {
      await options.repository.failAudioDeletion(claim.id, claim.claimedAt).catch(() => {});
      audioDeleteFailed += 1;
    }
  }
  return { audioCleanupClaimed: claims.length, audioDeleted, audioDeleteFailed };
}
