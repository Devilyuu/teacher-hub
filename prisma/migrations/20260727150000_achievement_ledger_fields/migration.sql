-- AlterEnum
-- 线上绩效库的 level 实际用到 国家级/省级/市级/校级/学院级，而这里最低只有 SCHOOL；
-- DISTRICT 是行政区（市辖区、县级区等）不是院系，接不住"学院级"。放在 SCHOOL 之后，
-- 让数据库里的顺序和 schema.prisma 一致。
ALTER TYPE "Level" ADD VALUE IF NOT EXISTS 'COLLEGE' AFTER 'SCHOOL';

-- CreateEnum
CREATE TYPE "DeclareNature" AS ENUM ('PROCESS', 'RESULT');

-- CreateEnum
CREATE TYPE "AchievementUsage" AS ENUM ('PERFORMANCE', 'PROMOTION', 'PROJECT_CLOSING');

-- AlterTable
ALTER TABLE "Achievement"
    ADD COLUMN "perfCategoryId" TEXT,
    ADD COLUMN "year" INTEGER,
    ADD COLUMN "declareNature" "DeclareNature" NOT NULL DEFAULT 'RESULT',
    ADD COLUMN "stage" TEXT,
    ADD COLUMN "baseScore" DECIMAL(6,2),
    ADD COLUMN "perfScore" DECIMAL(6,2),
    ADD COLUMN "declaredScore" DECIMAL(6,2),
    ADD COLUMN "isTeamProject" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "teamNote" TEXT,
    ADD COLUMN "usableFor" "AchievementUsage"[] DEFAULT ARRAY[]::"AchievementUsage"[],
    ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Achievement_year_idx" ON "Achievement"("year");

-- CreateIndex
CREATE INDEX "Achievement_perfCategoryId_idx" ON "Achievement"("perfCategoryId");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_perfCategoryId_fkey"
    FOREIGN KEY ("perfCategoryId") REFERENCES "PerfCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
