-- Fail before changing the schema when legacy attachments do not already have
-- exactly one of the two pre-migration owners. Deliberate cleanup must happen
-- separately; this migration never guesses an owner or deletes data.
DO $$
DECLARE
    invalid_attachment_count INTEGER;
BEGIN
    SELECT count(*)
    INTO invalid_attachment_count
    FROM "Attachment"
    WHERE num_nonnulls("projectId", "achievementId") <> 1;

    IF invalid_attachment_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = format(
                'Cannot add personal documents: %s existing Attachment row(s) are ownerless or multiply owned',
                invalid_attachment_count
            ),
            HINT = 'Repair the legacy Attachment ownership explicitly, then retry the migration.';
    END IF;
END $$;

-- CreateTable
CREATE TABLE "DocCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocCategory_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "docCategoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DocCategory_name_key" ON "DocCategory"("name");

-- CreateIndex
CREATE INDEX "Attachment_docCategoryId_idx" ON "Attachment"("docCategoryId");

-- AddForeignKey
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_docCategoryId_fkey"
FOREIGN KEY ("docCategoryId") REFERENCES "DocCategory"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one attachment owner: project, achievement, or personal-document category.
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_single_owner"
CHECK (num_nonnulls("projectId", "achievementId", "docCategoryId") = 1);
