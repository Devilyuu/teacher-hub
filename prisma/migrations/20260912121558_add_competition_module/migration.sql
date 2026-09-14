-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('PLANNED', 'REGISTERED', 'TRAINING', 'COMPETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CompetitionAward" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'EXCELLENT', 'OTHER', 'NONE');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "competitionEntryId" TEXT;

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizer" TEXT,
    "level" "Level" NOT NULL DEFAULT 'UNRATED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "track" TEXT,
    "year" INTEGER NOT NULL,
    "editionText" TEXT,
    "level" "Level" NOT NULL DEFAULT 'UNRATED',
    "status" "CompetitionStatus" NOT NULL DEFAULT 'PLANNED',
    "registerDeadline" DATE,
    "competeAt" DATE,
    "competeDateText" TEXT,
    "competeDatePrecision" "DatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "award" "CompetitionAward",
    "awardTitle" TEXT,
    "awardedAt" DATE,
    "awardDateText" TEXT,
    "awardDatePrecision" "DatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "myOrder" INTEGER,
    "note" TEXT,
    "achievementId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionMember" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentId" TEXT,
    "note" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompetitionMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionCoach" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompetitionCoach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competition_name_key" ON "Competition"("name");

-- CreateIndex
CREATE INDEX "CompetitionEntry_year_level_idx" ON "CompetitionEntry"("year", "level");

-- CreateIndex
CREATE INDEX "CompetitionEntry_competitionId_year_idx" ON "CompetitionEntry"("competitionId", "year");

-- CreateIndex
CREATE INDEX "CompetitionEntry_registerDeadline_idx" ON "CompetitionEntry"("registerDeadline");

-- CreateIndex
CREATE INDEX "CompetitionEntry_status_idx" ON "CompetitionEntry"("status");

-- CreateIndex
CREATE INDEX "CompetitionMember_entryId_orderIndex_idx" ON "CompetitionMember"("entryId", "orderIndex");

-- CreateIndex
CREATE INDEX "CompetitionMember_studentId_idx" ON "CompetitionMember"("studentId");

-- CreateIndex
CREATE INDEX "CompetitionCoach_teacherId_idx" ON "CompetitionCoach"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionCoach_entryId_teacherId_key" ON "CompetitionCoach"("entryId", "teacherId");

-- CreateIndex
CREATE INDEX "Attachment_competitionEntryId_idx" ON "Attachment"("competitionEntryId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_competitionEntryId_fkey" FOREIGN KEY ("competitionEntryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMember" ADD CONSTRAINT "CompetitionMember_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMember" ADD CONSTRAINT "CompetitionMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionCoach" ADD CONSTRAINT "CompetitionCoach_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CompetitionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionCoach" ADD CONSTRAINT "CompetitionCoach_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 以下为手写约束（Prisma 不识别 CHECK，重生成迁移时要保住）─────────────

-- 附件单一归属从五列放宽到六列。理由同 20260805022613、20260831093000 那两次：
-- 新列不进 CHECK 就没用——挂 competitionEntryId 的行在旧约束下 num_nonnulls
-- 仍是 0，会按「无归属」被拒绝。ROLL-FORWARD ONLY：约束本身可以换回去，
-- 但换回去之前必须先迁走/删除所有参赛材料行。
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_single_owner";
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_single_owner"
CHECK (num_nonnulls("projectId", "achievementId", "docCategoryId", "teachingImportId", "studentHonorId", "competitionEntryId") = 1);
