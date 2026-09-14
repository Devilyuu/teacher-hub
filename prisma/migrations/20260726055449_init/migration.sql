-- CreateEnum
CREATE TYPE "Level" AS ENUM ('NATIONAL', 'PROVINCIAL', 'MUNICIPAL', 'DISTRICT', 'BUREAU', 'SCHOOL', 'INDUSTRY', 'HORIZONTAL', 'UNRATED');

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('RESEARCH', 'TEACHING_REFORM', 'EDU_RESEARCH', 'HORIZONTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('LEAD', 'CO_LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'APPLYING', 'ONGOING', 'CLOSING', 'CLOSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AchievementType" AS ENUM ('PAPER', 'REPORT', 'TEXTBOOK', 'CASE', 'PATENT', 'SOFTWARE_COPYRIGHT', 'AWARD', 'COURSE', 'STUDENT_ACHIEVEMENT', 'MEDIA_REPORT', 'FUNDING_RECEIPT', 'TRAINING', 'SOCIAL_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "AchievementStatus" AS ENUM ('PLANNED', 'TITLED', 'WRITING', 'DRAFTED', 'CHECKING', 'SUBMITTED', 'UNDER_REVIEW', 'REVISING', 'ACCEPTED', 'PUBLISHED', 'INDEXED', 'REJECTED', 'SHELVED');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR', 'RANGE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT,
    "code" TEXT,
    "level" "Level" NOT NULL DEFAULT 'UNRATED',
    "category" "ProjectCategory" NOT NULL DEFAULT 'RESEARCH',
    "grantingBody" TEXT,
    "hostUnit" TEXT,
    "role" "ProjectRole" NOT NULL DEFAULT 'LEAD',
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "applyDeadline" DATE,
    "startDate" DATE,
    "endDate" DATE,
    "closingDeadline" DATE,
    "fundingTotal" DECIMAL(12,2),
    "fundingReceived" DECIMAL(12,2),
    "researchContent" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "dateText" TEXT,
    "obsidianPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "allowedTypes" "AchievementType"[],
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "rawText" TEXT NOT NULL,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "dueDate" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "type" "AchievementType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AchievementStatus" NOT NULL DEFAULT 'PLANNED',
    "authorPosition" INTEGER,
    "ownerRole" TEXT,
    "level" "Level" NOT NULL DEFAULT 'UNRATED',
    "journalName" TEXT,
    "journalLevel" "Level",
    "indexedBy" TEXT,
    "wordCount" INTEGER,
    "completedAt" DATE,
    "publishedAt" DATE,
    "dateText" TEXT,
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "tags" TEXT[],
    "evidenceRef" TEXT,
    "obsidianPath" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementLink" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "isQualified" BOOLEAN NOT NULL DEFAULT false,
    "qualifiedAt" TIMESTAMP(3),
    "qualifyNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "role" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "department" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "obsidianVaultPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_archivedAt_idx" ON "Project"("archivedAt");

-- CreateIndex
CREATE INDEX "Requirement_projectId_sortOrder_idx" ON "Requirement"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "Achievement_type_idx" ON "Achievement"("type");

-- CreateIndex
CREATE INDEX "Achievement_status_idx" ON "Achievement"("status");

-- CreateIndex
CREATE INDEX "RequirementLink_achievementId_idx" ON "RequirementLink"("achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementLink_requirementId_achievementId_key" ON "RequirementLink"("requirementId", "achievementId");

-- CreateIndex
CREATE INDEX "Member_projectId_sortOrder_idx" ON "Member"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_createdAt_idx" ON "ActivityLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink" ADD CONSTRAINT "RequirementLink_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementLink" ADD CONSTRAINT "RequirementLink_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
