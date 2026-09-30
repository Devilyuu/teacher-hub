import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ExistingPerfRow, ExistingPromotionRow } from "@/lib/rules/preview";

/**
 * 设置 → 职称表与绩效表 的数据。两张表各有若干年度的版本：
 * **最大的那个年度就是「当前在用」**，录入界面的下拉只用它（currentPromotionYear / currentPerfYear）；
 * 旧年度留着，历史成果仍按当年的表解释。
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function getRuleTableYears(): Promise<{ promotion: number[]; perf: number[] }> {
  const [promotion, perf] = await Promise.all([
    prisma.promotionRuleset.findMany({ orderBy: { year: "desc" }, select: { year: true } }),
    prisma.perfCategory.groupBy({ by: ["year"], orderBy: { year: "desc" } }),
  ]);
  return { promotion: promotion.map((row) => row.year), perf: perf.map((row) => row.year) };
}

/** 设置页那张入口卡：两张表当前在用的是哪一版、几项 */
export async function getRuleTablesSummary() {
  const years = await getRuleTableYears();
  const [promotionCount, perfCount] = await Promise.all([
    years.promotion[0] == null ? 0 : prisma.promotionCategory.count({ where: { year: years.promotion[0] } }),
    years.perf[0] == null ? 0 : prisma.perfCategory.count({ where: { year: years.perf[0] } }),
  ]);
  return {
    promotion: years.promotion[0] == null ? null : { year: years.promotion[0], count: promotionCount },
    perf: years.perf[0] == null ? null : { year: years.perf[0], count: perfCount },
  };
}

export async function getPromotionTable(year: number) {
  const [ruleset, categories] = await Promise.all([
    prisma.promotionRuleset.findUnique({ where: { year } }),
    prisma.promotionCategory.findMany({
      where: { year },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: { _count: { select: { achievements: true, projects: true } } },
    }),
  ]);
  return {
    ruleset: ruleset
      ? {
          year: ruleset.year,
          source: ruleset.source,
          generalNotes: ruleset.generalNotes,
          updatedAt: ruleset.updatedAt,
        }
      : null,
    categories: categories.map((row) => ({
      id: row.id,
      year: row.year,
      code: row.code,
      majorIndicator: row.majorIndicator,
      majorCap: row.majorCap == null ? null : Number(row.majorCap),
      minorIndicator: row.minorIndicator,
      scoringRule: row.scoringRule,
      remark: row.remark,
      cap: row.cap == null ? null : Number(row.cap),
      capGroup: row.capGroup,
      capNote: row.capNote,
      projectEligible: row.projectEligible,
      updatedAt: row.updatedAt,
      achievementCount: row._count.achievements,
      projectCount: row._count.projects,
    })),
  };
}

export async function getPerfTable(year: number) {
  const categories = await prisma.perfCategory.findMany({
    where: { year },
    orderBy: [{ sortOrder: "asc" }, { minorCategory: "asc" }],
    include: { _count: { select: { achievements: true, projectPerformanceEvents: true } } },
  });
  return categories.map((row) => ({
    id: row.id,
    year: row.year,
    majorCategory: row.majorCategory,
    minorCategory: row.minorCategory,
    baseRule: row.baseRule,
    nationalRule: row.nationalRule,
    provincialRule: row.provincialRule,
    cityRule: row.cityRule,
    schoolRule: row.schoolRule,
    collegeRule: row.collegeRule,
    remark: row.remark,
    isTeam: row.isTeam,
    isDepartmentAssigned: row.isDepartmentAssigned,
    isActive: row.isActive,
    projectEligible: row.projectEligible,
    updatedAt: row.updatedAt,
    achievementCount: row._count.achievements,
    eventCount: row._count.projectPerformanceEvents,
  }));
}

/** 导入预览要跟库里比的那一年的行（lib/rules/preview.ts） */
export async function loadExistingPromotionRows(db: Db, year: number): Promise<ExistingPromotionRow[]> {
  const rows = await db.promotionCategory.findMany({
    where: { year },
    include: { _count: { select: { achievements: true, projects: true } } },
  });
  return rows.map((row) => ({
    code: row.code,
    majorIndicator: row.majorIndicator,
    majorCap: row.majorCap == null ? null : Number(row.majorCap),
    minorIndicator: row.minorIndicator,
    scoringRule: row.scoringRule,
    remark: row.remark,
    cap: row.cap == null ? null : Number(row.cap),
    capGroup: row.capGroup,
    capNote: row.capNote,
    appliesTo: row.appliesTo,
    projectEligible: row.projectEligible,
    linkedCount: row._count.achievements + row._count.projects,
  }));
}

export async function loadExistingPerfRows(db: Db, year: number): Promise<ExistingPerfRow[]> {
  const rows = await db.perfCategory.findMany({
    where: { year },
    include: { _count: { select: { achievements: true, projectPerformanceEvents: true } } },
  });
  return rows.map((row) => ({
    majorCategory: row.majorCategory,
    minorCategory: row.minorCategory,
    baseRule: row.baseRule,
    nationalRule: row.nationalRule,
    provincialRule: row.provincialRule,
    cityRule: row.cityRule,
    schoolRule: row.schoolRule,
    collegeRule: row.collegeRule,
    remark: row.remark,
    isTeam: row.isTeam,
    isDepartmentAssigned: row.isDepartmentAssigned,
    isActive: row.isActive,
    projectEligible: row.projectEligible,
    linkedCount: row._count.achievements + row._count.projectPerformanceEvents,
  }));
}
