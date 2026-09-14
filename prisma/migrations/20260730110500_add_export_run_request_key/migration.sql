-- AlterTable
ALTER TABLE "ExportRun" ADD COLUMN "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExportRun_requestKey_key" ON "ExportRun"("requestKey");
