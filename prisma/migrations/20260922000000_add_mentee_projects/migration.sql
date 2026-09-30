-- 学业导师模块 M2：学生项目（毕设/大创/作品）+ 关键节点 + 材料
-- 规格：docs/superpowers/specs/2026-09-21-mentor-module-design.md §5.3、§9
--
-- **ROLL-FORWARD ONLY**：末尾那条 Attachment_single_owner 把归属从六列放宽到七列。
-- 约束本身可以换回去，但换回去之前必须先迁走/删除所有挂 menteeProjectId 的行。
-- 其余部分（建表、加可空列、索引、外键）都是可回滚的。

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "menteeProjectId" TEXT;

-- AlterTable
ALTER TABLE "MenteeRecord" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "MenteeProjectKind" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenteeProjectKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeProject" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kindId" TEXT NOT NULL,
    "schoolYear" TEXT,
    "outcomeText" TEXT,
    "note" TEXT,
    "achievementId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenteeProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenteeProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenteeProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "date" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenteeProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenteeProjectKind_name_key" ON "MenteeProjectKind"("name");

-- CreateIndex
CREATE INDEX "MenteeProject_batchId_createdAt_idx" ON "MenteeProject"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "MenteeProject_kindId_idx" ON "MenteeProject"("kindId");

-- CreateIndex
CREATE INDEX "MenteeProjectMember_menteeId_idx" ON "MenteeProjectMember"("menteeId");

-- CreateIndex
CREATE UNIQUE INDEX "MenteeProjectMember_projectId_menteeId_key" ON "MenteeProjectMember"("projectId", "menteeId");

-- CreateIndex
CREATE INDEX "MenteeProjectMilestone_projectId_date_idx" ON "MenteeProjectMilestone"("projectId", "date");

-- CreateIndex
CREATE INDEX "MenteeProjectMilestone_date_idx" ON "MenteeProjectMilestone"("date");

-- CreateIndex
CREATE INDEX "Attachment_menteeProjectId_idx" ON "Attachment"("menteeProjectId");

-- CreateIndex
CREATE INDEX "MenteeRecord_projectId_idx" ON "MenteeRecord"("projectId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_menteeProjectId_fkey" FOREIGN KEY ("menteeProjectId") REFERENCES "MenteeProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeRecord" ADD CONSTRAINT "MenteeRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MenteeProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProject" ADD CONSTRAINT "MenteeProject_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MenteeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProject" ADD CONSTRAINT "MenteeProject_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "MenteeProjectKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProject" ADD CONSTRAINT "MenteeProject_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProjectMember" ADD CONSTRAINT "MenteeProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MenteeProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProjectMember" ADD CONSTRAINT "MenteeProjectMember_menteeId_fkey" FOREIGN KEY ("menteeId") REFERENCES "Mentee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenteeProjectMilestone" ADD CONSTRAINT "MenteeProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MenteeProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 以下为手写约束（Prisma 不识别 CHECK，重生成迁移时要保住）─────────────

-- 附件单一归属从六列放宽到七列。理由同 20260805022613、20260831093000、
-- 20260912121558 那三次：**新列不进 CHECK 就没用**——挂 menteeProjectId 的行
-- 在旧约束下 num_nonnulls 仍是 0，会按「无归属」被整条拒绝，而且
-- `prisma migrate diff --exit-code` 发现不了漏写（它看不见 CHECK）。
-- 表现是运行时上传材料直接失败、CI 全绿。DROP 再 ADD 时**六个旧列一个都不能丢**。
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_single_owner";
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_single_owner"
CHECK (num_nonnulls("projectId", "achievementId", "docCategoryId", "teachingImportId", "studentHonorId", "competitionEntryId", "menteeProjectId") = 1);
