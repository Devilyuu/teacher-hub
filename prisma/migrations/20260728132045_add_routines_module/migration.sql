-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('SUPERIOR', 'MEETING', 'SELF');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'DOING', 'DONE');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('REGULAR', 'TOPIC', 'TEMP');

-- CreateEnum
CREATE TYPE "AgendaStatus" AS ENUM ('PENDING', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RecurringFreq" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" "TaskSource" NOT NULL DEFAULT 'SELF',
    "assignee" TEXT NOT NULL DEFAULT '我',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" DATE,
    "relatedProjectId" TEXT,
    "note" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingTime" TIMESTAMP(3) NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'REGULAR',
    "agenda" JSONB NOT NULL DEFAULT '[]',
    "minutes" TEXT,
    "resolutions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "AgendaStatus" NOT NULL DEFAULT 'PENDING',
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignee" TEXT NOT NULL DEFAULT '我',
    "source" "TaskSource" NOT NULL DEFAULT 'SELF',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "relatedProjectId" TEXT,
    "note" TEXT,
    "freq" "RecurringFreq" NOT NULL,
    "day" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunYmd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRecord" (
    "id" TEXT NOT NULL,
    "dutyTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DutyParticipants" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DutyParticipants_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

-- CreateIndex
CREATE INDEX "Task_relatedProjectId_idx" ON "Task"("relatedProjectId");

-- CreateIndex
CREATE INDEX "Meeting_meetingTime_idx" ON "Meeting"("meetingTime");

-- CreateIndex
CREATE INDEX "AgendaItem_status_idx" ON "AgendaItem"("status");

-- CreateIndex
CREATE INDEX "RecurringRule_active_idx" ON "RecurringRule"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_name_key" ON "Teacher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DutyType_name_key" ON "DutyType"("name");

-- CreateIndex
CREATE INDEX "DutyType_name_idx" ON "DutyType"("name");

-- CreateIndex
CREATE INDEX "DutyRecord_date_idx" ON "DutyRecord"("date");

-- CreateIndex
CREATE INDEX "DutyRecord_dutyTypeId_idx" ON "DutyRecord"("dutyTypeId");

-- CreateIndex
CREATE INDEX "_DutyParticipants_B_index" ON "_DutyParticipants"("B");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_relatedProjectId_fkey" FOREIGN KEY ("relatedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_relatedProjectId_fkey" FOREIGN KEY ("relatedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRecord" ADD CONSTRAINT "DutyRecord_dutyTypeId_fkey" FOREIGN KEY ("dutyTypeId") REFERENCES "DutyType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DutyParticipants" ADD CONSTRAINT "_DutyParticipants_A_fkey" FOREIGN KEY ("A") REFERENCES "DutyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DutyParticipants" ADD CONSTRAINT "_DutyParticipants_B_fkey" FOREIGN KEY ("B") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
