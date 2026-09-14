-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PROPOSAL', 'APPROVAL', 'CONTRACT', 'MIDTERM', 'FINAL_REPORT', 'CERTIFICATE', 'ACCEPTANCE', 'PUBLICATION', 'INDEX_PROOF', 'CHECK_REPORT', 'OTHER');

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "achievementId" TEXT,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "note" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storagePath_key" ON "Attachment"("storagePath");

-- CreateIndex
CREATE INDEX "Attachment_projectId_kind_idx" ON "Attachment"("projectId", "kind");

-- CreateIndex
CREATE INDEX "Attachment_achievementId_kind_idx" ON "Attachment"("achievementId", "kind");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
