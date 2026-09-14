-- CreateTable
CREATE TABLE "RequirementAttachment" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementAttachment_attachmentId_idx" ON "RequirementAttachment"("attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementAttachment_requirementId_attachmentId_key" ON "RequirementAttachment"("requirementId", "attachmentId");

-- AddForeignKey
ALTER TABLE "RequirementAttachment" ADD CONSTRAINT "RequirementAttachment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAttachment" ADD CONSTRAINT "RequirementAttachment_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
