-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM (
  'PERF_DECLARATION',
  'PROMOTION_DECLARATION',
  'PROJECT_CLOSEOUT',
  'MATERIAL_ZIP'
);

-- CreateTable
CREATE TABLE "ExportRun" (
  "id" TEXT NOT NULL,
  "kind" "ExportKind" NOT NULL,
  "year" INTEGER,
  "projectId" TEXT,
  "options" JSONB NOT NULL,
  "includedCount" INTEGER NOT NULL,
  "issueSummary" JSONB NOT NULL,
  "snapshot" JSONB NOT NULL,
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportRun_kind_createdAt_idx" ON "ExportRun"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRun_projectId_idx" ON "ExportRun"("projectId");
