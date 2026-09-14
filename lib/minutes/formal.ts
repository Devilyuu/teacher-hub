import { createHash } from "node:crypto";
import { normalizeLineEndings } from "@/lib/line-endings";

export const AUTOMATIC_MINUTES_BEGIN = "<!-- teacher-desk:auto-minutes:begin:v1 -->";
export const AUTOMATIC_MINUTES_END = "<!-- teacher-desk:auto-minutes:end:v1 -->";

const AUTOMATIC_MINUTES_HASH_PREFIX = "<!-- teacher-desk:auto-minutes:sha256:";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function automaticRegion(automaticMinutes: string): string {
  const normalizedMinutes = normalizeLineEndings(automaticMinutes);
  return [
    AUTOMATIC_MINUTES_BEGIN,
    `${AUTOMATIC_MINUTES_HASH_PREFIX}${digest(normalizedMinutes)} -->`,
    normalizedMinutes,
    AUTOMATIC_MINUTES_END,
  ].join("\n");
}

type ValidRegion = { start: number; end: number };

function findLastValidRegion(value: string): ValidRegion | null {
  const validRegions: ValidRegion[] = [];
  let beginAt = value.indexOf(AUTOMATIC_MINUTES_BEGIN);

  while (beginAt !== -1) {
    const hashAt = beginAt + AUTOMATIC_MINUTES_BEGIN.length + 1;
    if (value.startsWith(AUTOMATIC_MINUTES_HASH_PREFIX, hashAt)) {
      const hashEnd = value.indexOf(" -->\n", hashAt + AUTOMATIC_MINUTES_HASH_PREFIX.length);
      const claimedHash = hashEnd === -1
        ? ""
        : value.slice(hashAt + AUTOMATIC_MINUTES_HASH_PREFIX.length, hashEnd);
      const bodyAt = hashEnd === -1 ? -1 : hashEnd + " -->\n".length;
      let endAt = bodyAt === -1 ? -1 : value.indexOf(`\n${AUTOMATIC_MINUTES_END}`, bodyAt);

      while (endAt !== -1) {
        const body = value.slice(bodyAt, endAt);
        if (/^[a-f0-9]{64}$/.test(claimedHash) && digest(body) === claimedHash) {
          validRegions.push({
            start: beginAt,
            end: endAt + 1 + AUTOMATIC_MINUTES_END.length,
          });
          break;
        }
        endAt = value.indexOf(`\n${AUTOMATIC_MINUTES_END}`, endAt + 1);
      }
    }

    beginAt = value.indexOf(AUTOMATIC_MINUTES_BEGIN, beginAt + AUTOMATIC_MINUTES_BEGIN.length);
  }

  const outermostRegions = validRegions.filter((candidate) => !validRegions.some((other) => (
    other.start < candidate.start && other.end > candidate.end
  )));
  return outermostRegions.at(-1) ?? null;
}

export function mergeAutomaticMinutes(existingMinutes: string | null | undefined, automaticMinutes: string): string {
  const existing = normalizeLineEndings(existingMinutes ?? "");
  const replacement = automaticRegion(automaticMinutes);
  const validRegion = findLastValidRegion(existing);

  if (validRegion) {
    return `${existing.slice(0, validRegion.start)}${replacement}${existing.slice(validRegion.end)}`;
  }
  if (existing.trim().length === 0) return replacement;
  return `${existing}\n\n${replacement}`;
}

export type AutomaticFormalResolution = {
  recordingId: string;
  candidateId: string;
  text: string;
  assignee: string;
  dueDate: string | null;
  convertedTaskId: string | null;
};

function identifiedAutomaticResolution(value: unknown): value is Record<string, unknown> & {
  recordingId: string;
  candidateId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.recordingId === "string"
    && candidate.recordingId.length > 0
    && typeof candidate.candidateId === "string"
    && candidate.candidateId.length > 0;
}

function automaticResolutionKey(value: { recordingId: string; candidateId: string }): string {
  return JSON.stringify([value.recordingId, value.candidateId]);
}

export function mergeAutomaticResolutions(
  existingResolutions: unknown,
  automaticResolutions: AutomaticFormalResolution[],
): unknown[] {
  const existing = Array.isArray(existingResolutions) ? existingResolutions : [];
  const manualOrLegacy = existing.filter((resolution) => !identifiedAutomaticResolution(resolution));
  const convertedTaskIds = new Map<string, string>();

  for (const resolution of existing) {
    if (!identifiedAutomaticResolution(resolution)) continue;
    if (typeof resolution.convertedTaskId === "string") {
      convertedTaskIds.set(automaticResolutionKey(resolution), resolution.convertedTaskId);
    }
  }

  const rebuilt = automaticResolutions.map((resolution) => ({
    ...resolution,
    convertedTaskId: convertedTaskIds.get(automaticResolutionKey(resolution)) ?? resolution.convertedTaskId,
  }));
  return [...manualOrLegacy, ...rebuilt];
}
