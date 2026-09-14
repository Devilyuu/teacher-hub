-- CreateEnum
CREATE TYPE "TitleSeries" AS ENUM ('TEACHER', 'LAB', 'IDEOLOGY', 'EDU_ADMIN');

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "promotionCategoryId" TEXT,
ADD COLUMN     "promotionScore" DECIMAL(6,2),
ALTER COLUMN "usableFor" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "currentTitle" TEXT,
ADD COLUMN     "currentTitleSince" DATE;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "promotionCategoryId" TEXT,
ADD COLUMN     "promotionScore" DECIMAL(6,2);

-- CreateTable
CREATE TABLE "PromotionCategory" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "majorIndicator" TEXT NOT NULL,
    "majorCap" DECIMAL(6,2) NOT NULL,
    "minorIndicator" TEXT NOT NULL,
    "scoringRule" TEXT NOT NULL,
    "remark" TEXT,
    "cap" DECIMAL(6,2),
    "capGroup" TEXT,
    "capNote" TEXT,
    "appliesTo" "TitleSeries"[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRuleset" (
    "year" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "generalNotes" TEXT[],
    "teacherTotal" DECIMAL(6,2) NOT NULL,
    "labTotal" DECIMAL(6,2) NOT NULL,
    "ideologyTotal" DECIMAL(6,2) NOT NULL,
    "eduAdminTotal" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionRuleset_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE INDEX "PromotionCategory_year_majorIndicator_idx" ON "PromotionCategory"("year", "majorIndicator");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionCategory_year_code_key" ON "PromotionCategory"("year", "code");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_promotionCategoryId_fkey" FOREIGN KEY ("promotionCategoryId") REFERENCES "PromotionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_promotionCategoryId_fkey" FOREIGN KEY ("promotionCategoryId") REFERENCES "PromotionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
