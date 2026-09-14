import "server-only";

import type { TranscriptSegment } from "@/lib/transcription/types";
import { MinutesAdapterError, type MinutesAdapter } from "./adapter";
import { chunkTranscriptSegments } from "./chunking";
import {
  createManualMinutesDraft,
  clientMinutesDraftSchema,
  withStableCandidateIds,
  type MinutesDraft,
} from "./schema";

export type DraftSource = {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  confirmedAt: Date | null;
};

export type ConfirmationResult = {
  alreadyConfirmed: boolean;
  needsAudioCleanup: boolean;
  taskIds: string[];
};

export type MinutesRepository = {
  getDraftSource(id: string): Promise<DraftSource | null>;
  saveDraft(id: string, draft: MinutesDraft): Promise<boolean>;
  recordGenerationFailure(id: string, failure: { errorCode: string; errorNote: string }): Promise<boolean>;
  confirm(id: string, draft: MinutesDraft, now: Date): Promise<ConfirmationResult>;
};

function requireDraftSource(source: DraftSource | null): DraftSource {
  if (!source?.transcript.trim()) throw new Error("这条录音还没有可整理的转写");
  if (source.confirmedAt) throw new Error("这份纪要已经确认");
  return source;
}

export async function saveRecordingMinutesDraft(
  id: string,
  input: unknown,
  repository: MinutesRepository,
): Promise<MinutesDraft> {
  const draft = clientMinutesDraftSchema.parse(input);
  if (!await repository.saveDraft(id, draft)) throw new Error("纪要草稿已变化，请刷新后重试");
  return draft;
}

export async function initializeManualMinutesDraft(
  id: string,
  repository: MinutesRepository,
): Promise<MinutesDraft> {
  requireDraftSource(await repository.getDraftSource(id));
  return saveRecordingMinutesDraft(id, createManualMinutesDraft(), repository);
}

export async function generateRecordingMinutes(
  id: string,
  options: {
    repository: MinutesRepository;
    adapter: MinutesAdapter | null;
    maxChars?: number;
  },
): Promise<{ mode: "generated" | "manual"; draft: MinutesDraft }> {
  if (!options.adapter) {
    return { mode: "manual", draft: await initializeManualMinutesDraft(id, options.repository) };
  }
  const source = requireDraftSource(await options.repository.getDraftSource(id));
  const segments = source.transcriptSegments.length > 0
    ? source.transcriptSegments
    : [{ text: source.transcript, startMs: 0, endMs: 0, speakerId: null }];
  const chunks = chunkTranscriptSegments(segments, options.maxChars);

  try {
    const points = [];
    for (const chunk of chunks) points.push(await options.adapter.summarizeChunk(chunk));
    const generated = await options.adapter.mergePoints(points);
    const draft = withStableCandidateIds(generated);
    await saveRecordingMinutesDraft(id, draft, options.repository);
    return { mode: "generated", draft };
  } catch (error) {
    const errorCode = error instanceof MinutesAdapterError ? error.code : "MINUTES_GENERATION_FAILED";
    await options.repository.recordGenerationFailure(id, {
      errorCode,
      errorNote: "纪要生成失败，可重试或手工整理",
    }).catch(() => {});
    throw error;
  }
}

export async function confirmRecordingMinutes(
  id: string,
  input: unknown,
  options: {
    repository: MinutesRepository;
    removeAudio: (id: string) => Promise<unknown>;
    now?: () => Date;
  },
): Promise<{ alreadyConfirmed: boolean; taskIds: string[]; audio: "deleted" | "pending" | "absent" }> {
  const draft = clientMinutesDraftSchema.parse(input);
  const confirmation = await options.repository.confirm(id, draft, options.now?.() ?? new Date());
  if (!confirmation.needsAudioCleanup) {
    return { alreadyConfirmed: confirmation.alreadyConfirmed, taskIds: confirmation.taskIds, audio: "absent" };
  }
  try {
    await options.removeAudio(id);
    return { alreadyConfirmed: confirmation.alreadyConfirmed, taskIds: confirmation.taskIds, audio: "deleted" };
  } catch {
    return { alreadyConfirmed: confirmation.alreadyConfirmed, taskIds: confirmation.taskIds, audio: "pending" };
  }
}
