-- Increment 3.3 is forward-only. Rolling back the app keeps this table and enum values.
CREATE TYPE "RecordingSource" AS ENUM ('UPLOAD', 'BROWSER');
CREATE TYPE "RecordingStatus" AS ENUM (
  'UPLOADING', 'UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED',
  'DRAFT_READY', 'CONFIRMED', 'DELETE_PENDING', 'AUDIO_DELETED', 'FAILED'
);

ALTER TABLE "Meeting"
  ADD COLUMN "transcriptionEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "MeetingRecording" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "source" "RecordingSource" NOT NULL,
  "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADING',
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "durationSec" INTEGER,
  "bytes" INTEGER NOT NULL DEFAULT 0,
  "storagePath" TEXT,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "expectedChunks" INTEGER,
  "provider" TEXT,
  "providerTaskId" TEXT,
  "cloudConsentAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "transcript" TEXT,
  "transcriptSegments" JSONB,
  "draftSummary" TEXT,
  "draftDiscussion" TEXT,
  "draftResolutions" JSONB,
  "draftTasks" JSONB,
  "draftOpenIssues" JSONB,
  "errorCode" TEXT,
  "errorNote" TEXT,
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "audioDeletedAt" TIMESTAMP(3),
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MeetingRecording_bytes_check" CHECK ("bytes" >= 0 AND "bytes" <= 104857600),
  CONSTRAINT "MeetingRecording_duration_check" CHECK ("durationSec" IS NULL OR ("durationSec" >= 0 AND "durationSec" <= 7200)),
  CONSTRAINT "MeetingRecording_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "MeetingRecording_storagePath_key" ON "MeetingRecording"("storagePath");
CREATE INDEX "MeetingRecording_status_expiresAt_idx" ON "MeetingRecording"("status", "expiresAt");
CREATE INDEX "MeetingRecording_status_claimedAt_idx" ON "MeetingRecording"("status", "claimedAt");
CREATE INDEX "MeetingRecording_status_createdAt_idx" ON "MeetingRecording"("status", "createdAt");
CREATE INDEX "MeetingRecording_meetingId_idx" ON "MeetingRecording"("meetingId");

ALTER TABLE "MeetingRecording"
  ADD CONSTRAINT "MeetingRecording_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
