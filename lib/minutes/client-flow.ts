export const AUDIO_DELETE_CONFIRMATION = "删除后无法回听。转写和纪要草稿仍会保留。确认删除原音频吗？";

export function confirmRecordingAudioDeletion(confirm: (message: string) => boolean): boolean {
  return confirm(AUDIO_DELETE_CONFIRMATION);
}

export function createManualCandidateId(
  kind: "resolution" | "task" | "issue",
  uniqueId = crypto.randomUUID(),
): string {
  const safeId = uniqueId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 73);
  return `${kind}-manual-${safeId}`;
}
