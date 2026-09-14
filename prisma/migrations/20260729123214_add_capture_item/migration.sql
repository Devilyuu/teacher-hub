-- CreateEnum
CREATE TYPE "CaptureKind" AS ENUM ('TASK', 'ACHIEVEMENT', 'NOTE');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('INBOX', 'SNOOZED', 'CONVERTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "CaptureItem" (
    "id" TEXT NOT NULL,
    "kind" "CaptureKind" NOT NULL DEFAULT 'TASK',
    "status" "CaptureStatus" NOT NULL DEFAULT 'INBOX',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "snoozedUntil" DATE,
    "convertedTaskId" TEXT,
    "convertedAchievementId" TEXT,
    "convertedMeetingId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "CaptureItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_convertedTaskId_key" ON "CaptureItem"("convertedTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_convertedAchievementId_key" ON "CaptureItem"("convertedAchievementId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_convertedMeetingId_key" ON "CaptureItem"("convertedMeetingId");

-- CreateIndex
CREATE INDEX "CaptureItem_status_createdAt_idx" ON "CaptureItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptureItem_status_snoozedUntil_idx" ON "CaptureItem"("status", "snoozedUntil");

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_convertedTaskId_fkey" FOREIGN KEY ("convertedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_convertedAchievementId_fkey" FOREIGN KEY ("convertedAchievementId") REFERENCES "Achievement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_convertedMeetingId_fkey" FOREIGN KEY ("convertedMeetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
