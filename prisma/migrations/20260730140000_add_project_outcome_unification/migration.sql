-- CreateEnum
CREATE TYPE "ProjectPerformanceEventKind" AS ENUM ('APPLY', 'APPROVED', 'FUNDING', 'CLOSEOUT', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolRewardDomain" AS ENUM ('PARTY_IDEOLOGY', 'TEACHING', 'RESEARCH', 'SOCIAL_SERVICE', 'COMPREHENSIVE_HONOR');

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectPerformanceEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectPerformanceEventKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "dateText" TEXT,
    "occurredAt" DATE,
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "perfCategoryId" TEXT,
    "baseScore" DECIMAL(6,2),
    "perfScore" DECIMAL(6,2),
    "declaredScore" DECIMAL(6,2),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "externalRef" TEXT,
    "legacyAchievementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPerformanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolRewardDecision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "achievementId" TEXT,
    "approvedAt" DATE NOT NULL,
    "batch" TEXT,
    "domain" "SchoolRewardDomain" NOT NULL,
    "awardItem" TEXT NOT NULL,
    "awardLevel" TEXT,
    "awardAmountYuan" DECIMAL(12,2),
    "evidenceRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolRewardDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPerformanceEvent_externalRef_key" ON "ProjectPerformanceEvent"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPerformanceEvent_legacyAchievementId_key" ON "ProjectPerformanceEvent"("legacyAchievementId");

-- CreateIndex
CREATE INDEX "ProjectPerformanceEvent_projectId_year_idx" ON "ProjectPerformanceEvent"("projectId", "year");

-- CreateIndex
CREATE INDEX "ProjectPerformanceEvent_perfCategoryId_idx" ON "ProjectPerformanceEvent"("perfCategoryId");

-- CreateIndex
CREATE INDEX "SchoolRewardDecision_projectId_idx" ON "SchoolRewardDecision"("projectId");

-- CreateIndex
CREATE INDEX "SchoolRewardDecision_achievementId_idx" ON "SchoolRewardDecision"("achievementId");

-- CreateIndex
CREATE INDEX "Achievement_archivedAt_idx" ON "Achievement"("archivedAt");

-- AddForeignKey
ALTER TABLE "ProjectPerformanceEvent" ADD CONSTRAINT "ProjectPerformanceEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPerformanceEvent" ADD CONSTRAINT "ProjectPerformanceEvent_perfCategoryId_fkey" FOREIGN KEY ("perfCategoryId") REFERENCES "PerfCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPerformanceEvent" ADD CONSTRAINT "ProjectPerformanceEvent_legacyAchievementId_fkey" FOREIGN KEY ("legacyAchievementId") REFERENCES "Achievement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolRewardDecision" ADD CONSTRAINT "SchoolRewardDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolRewardDecision" ADD CONSTRAINT "SchoolRewardDecision_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Achievement 只允许使用 2.7 定义的课题绩效副本归档原因。
ALTER TABLE "Achievement"
ADD CONSTRAINT "Achievement_archiveReason_check"
CHECK ("archiveReason" IS NULL OR "archiveReason" = 'MERGED_PROJECT_DUPLICATE');

-- 学校奖励审定必须且只能指向一个课题或一个成果。
ALTER TABLE "SchoolRewardDecision"
ADD CONSTRAINT "SchoolRewardDecision_exactly_one_target_check"
CHECK (num_nonnulls("projectId", "achievementId") = 1);
