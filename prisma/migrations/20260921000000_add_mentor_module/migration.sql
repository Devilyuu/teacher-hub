-- 学业导师模块（M1：名单 + 指导记录）
-- 规格：docs/superpowers/specs/2026-09-21-mentor-module-design.md
--
-- **这条迁移可以回滚**：只加表、加可空列、加索引与外键，不动任何既有数据，
-- 也不碰 Attachment 的 num_nonnulls CHECK（那是 M2 的事，那一刀才是 ROLL-FORWARD ONLY）。
--
-- 键名当心：advisor = 班主任（Student/ClassGroup），mentor = 学业导师（Mentee/MenteeBatch）。
-- 两套表刻意不合并，理由见 schema.prisma 里 Mentee 的注释。

-- AlterTable
ALTER TABLE "CaptureItem" ADD COLUMN     "convertedMenteeRecordId" TEXT;

-- CreateTable
CREATE TABLE "MenteeBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenteeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mentee" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentId" TEXT,
    "studentNo" TEXT,
    "className" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mentee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeRecordType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenteeRecordType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenteeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeRecordMember" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,

    CONSTRAINT "MenteeRecordMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenteeBatch_name_key" ON "MenteeBatch"("name");

-- CreateIndex
CREATE INDEX "MenteeBatch_archivedAt_year_idx" ON "MenteeBatch"("archivedAt", "year");

-- CreateIndex
CREATE INDEX "Mentee_batchId_active_idx" ON "Mentee"("batchId", "active");

-- CreateIndex
CREATE INDEX "Mentee_studentId_idx" ON "Mentee"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "MenteeRecordType_name_key" ON "MenteeRecordType"("name");

-- CreateIndex
CREATE INDEX "MenteeRecord_batchId_date_idx" ON "MenteeRecord"("batchId", "date");

-- CreateIndex
CREATE INDEX "MenteeRecord_typeId_idx" ON "MenteeRecord"("typeId");

-- CreateIndex
CREATE INDEX "MenteeRecordMember_menteeId_idx" ON "MenteeRecordMember"("menteeId");

-- CreateIndex
CREATE UNIQUE INDEX "MenteeRecordMember_recordId_menteeId_key" ON "MenteeRecordMember"("recordId", "menteeId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_convertedMenteeRecordId_key" ON "CaptureItem"("convertedMenteeRecordId");

-- AddForeignKey
ALTER TABLE "Mentee" ADD CONSTRAINT "Mentee_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MenteeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mentee" ADD CONSTRAINT "Mentee_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeRecord" ADD CONSTRAINT "MenteeRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MenteeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeRecord" ADD CONSTRAINT "MenteeRecord_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MenteeRecordType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeRecordMember" ADD CONSTRAINT "MenteeRecordMember_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MenteeRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeRecordMember" ADD CONSTRAINT "MenteeRecordMember_menteeId_fkey" FOREIGN KEY ("menteeId") REFERENCES "Mentee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_convertedMenteeRecordId_fkey" FOREIGN KEY ("convertedMenteeRecordId") REFERENCES "MenteeRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

