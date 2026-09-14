-- 轮派参与者：Prisma 隐式 m2m（`_DutyParticipants`）→ 显式连接表 `DutyParticipant`。
--
-- 改的理由是一条**沉默的数据缺口**：隐式表不是 model，全库 JSON 备份的表清单
-- （lib/backup/tables.ts）根本看不见它——备份里轮派记录一条不少、参与者却全是空的，
-- 而且不报任何错。「这次派了谁、下次该轮到谁」正是这个模块存在的理由。
--
-- **顺序是这份迁移的全部要害。** `prisma migrate dev` 生成的版本把
-- `DROP TABLE "_DutyParticipants"` 排在 CreateTable 之前，照那个顺序跑，
-- 这次修补本身就会把要救的数据删干净。这里改成：**先建表、再回填、最后才删**。

-- CreateTable
CREATE TABLE "DutyParticipant" (
    "id" TEXT NOT NULL,
    "dutyRecordId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,

    CONSTRAINT "DutyParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DutyParticipant_teacherId_idx" ON "DutyParticipant"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "DutyParticipant_dutyRecordId_teacherId_key" ON "DutyParticipant"("dutyRecordId", "teacherId");

-- AddForeignKey
ALTER TABLE "DutyParticipant" ADD CONSTRAINT "DutyParticipant_dutyRecordId_fkey" FOREIGN KEY ("dutyRecordId") REFERENCES "DutyRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyParticipant" ADD CONSTRAINT "DutyParticipant_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 回填（手写，Prisma 不会生成）────────────────────────────────────
--
-- 隐式表的列名是 Prisma 定的：两个模型名按字母序，A = DutyRecord、B = Teacher
-- （旧库里的外键 `_DutyParticipants_A_fkey → DutyRecord(id)` 可以复核这一点）。
--
-- id 用 `gen_random_uuid()::text` 而不是 cuid：SQL 里生成不了 cuid，而 id 是
-- 不透明字符串，两种格式在库里并存没有任何影响。gen_random_uuid() 是 PG 13+ 内置的。
INSERT INTO "DutyParticipant" ("id", "dutyRecordId", "teacherId")
SELECT gen_random_uuid()::text, "A", "B" FROM "_DutyParticipants";

-- 回填完才拆旧表。**ROLL-FORWARD ONLY**：回滚这步之前得先把 DutyParticipant
-- 的行反向搬回隐式表，否则参与者一样会没。
-- DropForeignKey
ALTER TABLE "_DutyParticipants" DROP CONSTRAINT "_DutyParticipants_A_fkey";

-- DropForeignKey
ALTER TABLE "_DutyParticipants" DROP CONSTRAINT "_DutyParticipants_B_fkey";

-- DropTable
DROP TABLE "_DutyParticipants";
