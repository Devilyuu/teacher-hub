import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

describe("real PostgreSQL meeting recording verifier", () => {
  it("covers quota, claim fencing, lease recovery, disabled meetings, and cleanup", () => {
    const source = read("scripts/verify-meeting-recording.ts");
    for (const marker of [
      "quotaRejected", "secondClaimRejected", "staleWriteRejected",
      "leaseRecovered", "disabledClaimRejected", "rowsLeftBehind",
    ]) expect(source).toContain(marker);
  });

  it("runs in the quality database CI job", () => {
    expect(JSON.parse(read("package.json")).scripts["verify:meeting-recording"]).toBeTruthy();
    expect(read(".github/workflows/ci.yml")).toContain("npm run verify:meeting-recording");
  });

  it("covers the complete minutes confirmation and audio cleanup lifecycle", () => {
    const source = read("scripts/verify-meeting-recording.ts");
    for (const marker of [
      "minutesConcurrentIdempotent",
      "multiRecordingSequentialPreserved",
      "multiRecordingConcurrentPreserved",
      "atomicDraftConfirmed",
      "minutesRollbackVerified",
      "confirmationSurvivedDeleteFailure",
      "daySixReminderFound",
      "daySevenAudioDeleted",
      "deletePendingRetried",
      "failedAsrRetained",
      "confirmedAfterAudioDeleted",
      "minutesFilesLeftBehind",
      "homePriorityBeyondEight",
      "keptManualMinutes",
      "keptManualResolution",
      "interleavedMeetingWritesSafe",
      "crlfMinutesSafe",
      "staleResolutionConflictSafe",
      "notePreserved",
    ]) expect(source).toContain(marker);
  });
});
