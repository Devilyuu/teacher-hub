-- CreateEnum
CREATE TYPE "TeachingImportStatus" AS ENUM ('RECEIVED', 'ADOPTED', 'DISMISSED', 'FAILED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "teachingImportId" TEXT;

-- CreateTable
CREATE TABLE "TeachingImport" (
    "id" TEXT NOT NULL,
    "externalSystem" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "courseName" TEXT,
    "finishedAt" DATE,
    "note" TEXT,
    "payload" JSONB NOT NULL,
    "status" "TeachingImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "achievementId" TEXT,
    "failureReason" TEXT,
    "ownerId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),

    CONSTRAINT "TeachingImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeachingImport_status_receivedAt_idx" ON "TeachingImport"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingImport_externalSystem_externalId_key" ON "TeachingImport"("externalSystem", "externalId");

-- CreateIndex
CREATE INDEX "Attachment_teachingImportId_idx" ON "Attachment"("teachingImportId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_teachingImportId_fkey" FOREIGN KEY ("teachingImportId") REFERENCES "TeachingImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingImport" ADD CONSTRAINT "TeachingImport_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Widen the single-owner rule from three columns to four. Prisma does not know
-- about this hand-written CHECK, so it must be updated here: the new column is
-- useless without it, because any row carrying teachingImportId would still
-- read as ownerless (num_nonnulls over the old three columns = 0) and be
-- rejected.
--
-- ROLL-FORWARD ONLY. The constraint itself can be swapped back, but the
-- three-column version can no longer be added once any row carries
-- teachingImportId — those rows would make ADD CONSTRAINT fail outright. The
-- rollback window closes the moment the first lesson plan arrives.
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_single_owner";
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_single_owner"
CHECK (num_nonnulls("projectId", "achievementId", "docCategoryId", "teachingImportId") = 1);
