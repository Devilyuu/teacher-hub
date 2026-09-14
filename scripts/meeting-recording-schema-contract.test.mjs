import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migrationUrl = new URL(
  "../prisma/migrations/20260803103000_add_meeting_recording/migration.sql",
  import.meta.url,
);

describe("MeetingRecording forward schema contract", () => {
  it("keeps the approved state machine and 3.4-compatible fields", () => {
    expect(schema).toMatch(/enum RecordingSource\s*{[\s\S]*UPLOAD[\s\S]*BROWSER[\s\S]*}/);
    for (const status of [
      "UPLOADING", "UPLOADED", "TRANSCRIBING", "TRANSCRIBED", "DRAFT_READY",
      "CONFIRMED", "DELETE_PENDING", "AUDIO_DELETED", "FAILED",
    ]) {
      expect(schema).toMatch(new RegExp(`enum RecordingStatus\\s*{[\\s\\S]*\\b${status}\\b`));
    }
    expect(schema).toContain("model MeetingRecording");
    expect(schema).toContain("recordings            MeetingRecording[]");
    expect(schema).toContain("transcriptionEnabled Boolean            @default(true)");
    expect(schema).toContain("claimedAt      DateTime?");
    expect(schema).toContain("providerTaskId String?");
    expect(schema).toContain("cloudConsentAt DateTime?");
    expect(schema).toContain("transcriptSegments Json?");
    expect(schema).toContain("draftSummary       String?");
    expect(schema).toContain("audioDeletedAt DateTime?");
  });

  it("ships a forward-only migration with lease and quota indexes", () => {
    const migration = readFileSync(migrationUrl, "utf8");
    expect(migration).toContain('CREATE TYPE "RecordingStatus"');
    expect(migration).toContain('CREATE TABLE "MeetingRecording"');
    expect(migration).toContain('MeetingRecording_status_claimedAt_idx');
    expect(migration).toContain('MeetingRecording_status_createdAt_idx');
    expect(migration).toContain('MeetingRecording_meetingId_fkey');
    expect(migration).not.toMatch(/DROP\s+(TABLE|TYPE|COLUMN)/i);
  });
});
