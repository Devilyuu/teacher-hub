-- 拆分「横向」这个概念，并把立项来源从自由文本升级成外键。
--
-- 注意执行顺序：必须先把 category/level 里的 HORIZONTAL 搬到新的 fundingType，
-- 再重建枚举。反过来做的话 `ALTER COLUMN ... TYPE` 会因为存量行取值非法而直接失败。
-- 同理，grantingBody 要先灌进 ProjectSource 才能 DROP。

-- ── 1. 新增结构 ────────────────────────────────────────────────

CREATE TYPE "FundingType" AS ENUM ('VERTICAL', 'HORIZONTAL');

CREATE TABLE "ProjectSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectSource_name_key" ON "ProjectSource"("name");
CREATE INDEX "ProjectSource_sortOrder_idx" ON "ProjectSource"("sortOrder");

ALTER TABLE "Project"
  ADD COLUMN "fundingType" "FundingType" NOT NULL DEFAULT 'VERTICAL',
  ADD COLUMN "sourceId" TEXT;

-- ── 2. 数据搬运（必须在重建枚举之前）────────────────────────────

-- 2a. 已填的立项单位升格成来源条目
INSERT INTO "ProjectSource" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, TRIM("grantingBody"), CURRENT_TIMESTAMP
FROM "Project"
WHERE "grantingBody" IS NOT NULL AND TRIM("grantingBody") <> ''
GROUP BY TRIM("grantingBody");

UPDATE "Project" p
SET "sourceId" = s."id"
FROM "ProjectSource" s
WHERE TRIM(p."grantingBody") = s."name";

-- 2b. 原先散在 category 和 level 两处的「横向」，收敛到 fundingType
UPDATE "Project"
SET "fundingType" = 'HORIZONTAL'
WHERE "category"::text = 'HORIZONTAL' OR "level"::text = 'HORIZONTAL';

-- 2c. 腾空即将被删除的枚举值。
--     横向项目绝大多数是科研性质，级别则是真的没有行政级别可言
UPDATE "Project" SET "category" = 'RESEARCH' WHERE "category"::text = 'HORIZONTAL';
UPDATE "Project" SET "level" = 'UNRATED' WHERE "level"::text = 'HORIZONTAL';
UPDATE "Achievement" SET "level" = 'UNRATED' WHERE "level"::text = 'HORIZONTAL';
UPDATE "Achievement" SET "journalLevel" = 'UNRATED' WHERE "journalLevel"::text = 'HORIZONTAL';

-- ── 3. 重建枚举（此时已无非法取值）──────────────────────────────

BEGIN;
CREATE TYPE "Level_new" AS ENUM ('NATIONAL', 'PROVINCIAL', 'MUNICIPAL', 'DISTRICT', 'BUREAU', 'SCHOOL', 'INDUSTRY', 'UNRATED');
ALTER TABLE "public"."Achievement" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "public"."Project" ALTER COLUMN "level" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "level" TYPE "Level_new" USING ("level"::text::"Level_new");
ALTER TABLE "Achievement" ALTER COLUMN "level" TYPE "Level_new" USING ("level"::text::"Level_new");
ALTER TABLE "Achievement" ALTER COLUMN "journalLevel" TYPE "Level_new" USING ("journalLevel"::text::"Level_new");
ALTER TYPE "Level" RENAME TO "Level_old";
ALTER TYPE "Level_new" RENAME TO "Level";
DROP TYPE "public"."Level_old";
ALTER TABLE "Achievement" ALTER COLUMN "level" SET DEFAULT 'UNRATED';
ALTER TABLE "Project" ALTER COLUMN "level" SET DEFAULT 'UNRATED';
COMMIT;

BEGIN;
CREATE TYPE "ProjectCategory_new" AS ENUM ('RESEARCH', 'TEACHING_REFORM', 'EDU_RESEARCH', 'OTHER');
ALTER TABLE "public"."Project" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "category" TYPE "ProjectCategory_new" USING ("category"::text::"ProjectCategory_new");
ALTER TYPE "ProjectCategory" RENAME TO "ProjectCategory_old";
ALTER TYPE "ProjectCategory_new" RENAME TO "ProjectCategory";
DROP TYPE "public"."ProjectCategory_old";
ALTER TABLE "Project" ALTER COLUMN "category" SET DEFAULT 'RESEARCH';
COMMIT;

-- ── 4. 收尾 ───────────────────────────────────────────────────

ALTER TABLE "Project" DROP COLUMN "grantingBody";

CREATE INDEX "Project_fundingType_idx" ON "Project"("fundingType");
CREATE INDEX "Project_sourceId_idx" ON "Project"("sourceId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "ProjectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
