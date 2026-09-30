-- 让别的学校的职称表、绩效表导得进来（2026-09-27）。
--
-- 1. 职称表放宽必填：一级上限、赋分原文、四个系列总分都改成可空。
--    本校以外的表多半没有这四个系列，条件制的表根本不计分、不设上限
-- 2. 两张表各加一列「课题可挂」，替代代码里写死的两份名单：
--    lib/promotion.ts 的 5.2 / 5.3，lib/project-performance.ts 的四个小类名。
--    换一所学校，编号和名字一个都对不上
--
-- 可回滚：加列与放宽 NOT NULL 都能撤。撤之前要先把导入时写进去的 NULL 补上值，
-- 否则 SET NOT NULL 会失败。

-- AlterTable
ALTER TABLE "PerfCategory" ADD COLUMN     "projectEligible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PromotionCategory" ADD COLUMN     "projectEligible" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "majorCap" DROP NOT NULL,
ALTER COLUMN "scoringRule" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PromotionRuleset" ALTER COLUMN "teacherTotal" DROP NOT NULL,
ALTER COLUMN "labTotal" DROP NOT NULL,
ALTER COLUMN "ideologyTotal" DROP NOT NULL,
ALTER COLUMN "eduAdminTotal" DROP NOT NULL;

-- 回填：照原来写死的两份名单勾上，升级后课题表单和课题绩效事项的候选跟升级前一模一样
UPDATE "PromotionCategory" SET "projectEligible" = true WHERE "code" IN ('5.2', '5.3');
UPDATE "PerfCategory" SET "projectEligible" = true
WHERE "minorCategory" IN ('纵向课题（教科研）', '横向课题及项目', '科技成果转化', '培训项目申报与到账');
