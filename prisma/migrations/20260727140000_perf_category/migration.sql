-- CreateTable
CREATE TABLE "PerfCategory" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "majorCategory" TEXT NOT NULL,
    "minorCategory" TEXT NOT NULL,
    "baseRule" TEXT,
    "nationalRule" TEXT,
    "provincialRule" TEXT,
    "cityRule" TEXT,
    "schoolRule" TEXT,
    "collegeRule" TEXT,
    "remark" TEXT,
    "isTeam" BOOLEAN NOT NULL DEFAULT false,
    "isDepartmentAssigned" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerfCategory_year_majorCategory_idx" ON "PerfCategory"("year", "majorCategory");

-- CreateIndex
CREATE UNIQUE INDEX "PerfCategory_year_majorCategory_minorCategory_key" ON "PerfCategory"("year", "majorCategory", "minorCategory");

-- CreateIndex
-- externalRef 现在只用于导入去重，必须唯一才能保证重复导入不产生第二条。
-- 建前已确认库里 19 条成果该字段全为空，Postgres 的唯一索引允许多个 NULL。
CREATE UNIQUE INDEX "Achievement_externalRef_key" ON "Achievement"("externalRef");
