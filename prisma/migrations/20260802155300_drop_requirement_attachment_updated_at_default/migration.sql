-- Align the database with Prisma's @updatedAt semantics without rewriting existing rows.
ALTER TABLE "RequirementAttachment" ALTER COLUMN "updatedAt" DROP DEFAULT;
