-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "studentHonorId" TEXT;

-- AlterTable
ALTER TABLE "CaptureItem" ADD COLUMN     "convertedStudentRecordId" TEXT;

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentNo" TEXT,
    "phone" TEXT,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "dormRoom" TEXT,
    "internshipUnit" TEXT,
    "internshipContact" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRelation" (
    "id" TEXT NOT NULL,
    "studentAId" TEXT NOT NULL,
    "studentBId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterChecklist" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterCheckmark" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterCheckmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentHonor" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" "Level" NOT NULL DEFAULT 'UNRATED',
    "issuer" TEXT,
    "isCollective" BOOLEAN NOT NULL DEFAULT false,
    "awardedAt" DATE,
    "dateText" TEXT,
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentHonor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentHonorMember" (
    "id" TEXT NOT NULL,
    "honorId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "StudentHonorMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRecordType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRecordType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRecord" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRecordMember" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "StudentRecordMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_name_key" ON "ClassGroup"("name");

-- CreateIndex
CREATE INDEX "Student_classGroupId_active_idx" ON "Student"("classGroupId", "active");

-- CreateIndex
CREATE INDEX "StudentRelation_studentBId_idx" ON "StudentRelation"("studentBId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRelation_studentAId_studentBId_key" ON "StudentRelation"("studentAId", "studentBId");

-- CreateIndex
CREATE INDEX "RosterChecklist_classGroupId_createdAt_idx" ON "RosterChecklist"("classGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "RosterCheckmark_studentId_idx" ON "RosterCheckmark"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterCheckmark_checklistId_studentId_key" ON "RosterCheckmark"("checklistId", "studentId");

-- CreateIndex
CREATE INDEX "StudentHonor_classGroupId_level_idx" ON "StudentHonor"("classGroupId", "level");

-- CreateIndex
CREATE INDEX "StudentHonor_classGroupId_awardedAt_idx" ON "StudentHonor"("classGroupId", "awardedAt");

-- CreateIndex
CREATE INDEX "StudentHonorMember_studentId_idx" ON "StudentHonorMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentHonorMember_honorId_studentId_key" ON "StudentHonorMember"("honorId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRecordType_name_key" ON "StudentRecordType"("name");

-- CreateIndex
CREATE INDEX "StudentRecord_classGroupId_date_idx" ON "StudentRecord"("classGroupId", "date");

-- CreateIndex
CREATE INDEX "StudentRecord_typeId_idx" ON "StudentRecord"("typeId");

-- CreateIndex
CREATE INDEX "StudentRecordMember_studentId_idx" ON "StudentRecordMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRecordMember_recordId_studentId_key" ON "StudentRecordMember"("recordId", "studentId");

-- CreateIndex
CREATE INDEX "Attachment_studentHonorId_idx" ON "Attachment"("studentHonorId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureItem_convertedStudentRecordId_key" ON "CaptureItem"("convertedStudentRecordId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_studentHonorId_fkey" FOREIGN KEY ("studentHonorId") REFERENCES "StudentHonor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRelation" ADD CONSTRAINT "StudentRelation_studentAId_fkey" FOREIGN KEY ("studentAId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRelation" ADD CONSTRAINT "StudentRelation_studentBId_fkey" FOREIGN KEY ("studentBId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterChecklist" ADD CONSTRAINT "RosterChecklist_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterCheckmark" ADD CONSTRAINT "RosterCheckmark_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "RosterChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterCheckmark" ADD CONSTRAINT "RosterCheckmark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHonor" ADD CONSTRAINT "StudentHonor_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHonorMember" ADD CONSTRAINT "StudentHonorMember_honorId_fkey" FOREIGN KEY ("honorId") REFERENCES "StudentHonor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentHonorMember" ADD CONSTRAINT "StudentHonorMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecord" ADD CONSTRAINT "StudentRecord_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecord" ADD CONSTRAINT "StudentRecord_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "StudentRecordType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecordMember" ADD CONSTRAINT "StudentRecordMember_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "StudentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecordMember" ADD CONSTRAINT "StudentRecordMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureItem" ADD CONSTRAINT "CaptureItem_convertedStudentRecordId_fkey" FOREIGN KEY ("convertedStudentRecordId") REFERENCES "StudentRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 以下为手写约束（Prisma 不识别 CHECK，重生成迁移时要保住）─────────────

-- 附件单一归属从四列放宽到五列。理由同 20260805022613 那次：
-- 新列不进 CHECK 就没用——挂 studentHonorId 的行在旧约束下 num_nonnulls
-- 仍是 0，会按「无归属」被拒绝。ROLL-FORWARD ONLY：约束本身可以换回去，
-- 但换回去之前必须先迁走/删除所有荣誉附件行。
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_single_owner";
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_single_owner"
CHECK (num_nonnulls("projectId", "achievementId", "docCategoryId", "teachingImportId", "studentHonorId") = 1);

-- 矛盾关系是无序对：钉死 A < B 这一种写法，(甲,乙) 和 (乙,甲) 不可能并存，
-- 顺带挡掉「自己和自己有矛盾」。Server Action 写入前先排序两个 id。
ALTER TABLE "StudentRelation"
ADD CONSTRAINT "StudentRelation_ordered_pair_check"
CHECK ("studentAId" < "studentBId");

