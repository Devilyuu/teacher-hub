import "server-only";
import { prisma } from "@/lib/db";
import type { PerfRuleColumns } from "@/lib/perf-rules";
import { PROJECT_PERF_MINORS } from "@/lib/project-performance";

export type PerfOption = {
  id: string;
  majorCategory: string;
  minorCategory: string;
  /**
   * 六列规则原文与备注，跟着下拉一起下发。
   *
   * 行内订正要在填分时把选中小类的规则摆出来——不然清存量时每填一个分
   * 都得另开一处查「教材编写出版 = 8/门」。**只显示不解析**，分仍由人填。
   */
  rules: PerfRuleColumns;
  remark: string | null;
};

/**
 * 当前在用的绩效对照表年度。取库里最大的那个——
 * 学校每年发新表时导入脚本写一个新年度，旧年度保留（历史成果按当年规则解释），
 * 但录入界面只用最新的一版。口径同 currentPromotionYear。
 */
export async function currentPerfYear(): Promise<number | null> {
  const latest = await prisma.perfCategory.findFirst({
    orderBy: { year: "desc" },
    select: { year: true },
  });
  return latest?.year ?? null;
}

/**
 * 绩效分类下拉。**此前这个字段只有导入脚本能写、界面只读**，
 * 结果是手工新建的成果永远挂不上绩效分类，详情页那一块就永远不显示。
 *
 * 只取 isActive 的：学校停用的条目不删（历史成果可能还挂着），但不该再选进新成果。
 */
export async function getPerfOptions(): Promise<PerfOption[]> {
  const year = await currentPerfYear();
  if (year == null) return [];

  const rows = await prisma.perfCategory.findMany({
    where: { year, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      majorCategory: true,
      minorCategory: true,
      baseRule: true,
      nationalRule: true,
      provincialRule: true,
      cityRule: true,
      schoolRule: true,
      collegeRule: true,
      remark: true,
    },
  });

  return rows.map(({ id, majorCategory, minorCategory, remark, ...rules }) => ({
    id,
    majorCategory,
    minorCategory,
    rules,
    remark,
  }));
}

/**
 * 课题绩效事项用的候选规则——课题这件事在绩效表上的几个去处。
 *
 * **只列候选，不替人选。** 「纵向课题 → 纵向课题（教科研）」看着理所当然，
 * 但那正是 CLAUDE.md 第 11 条禁止的映射函数：学校哪年把这两格合并或拆细，
 * 函数就开始骗人。做法与 `projectIndicatorOptions` 一致。
 *
 * 六列规则原文一并取回——界面要把该看的那一两列摆到分值输入框上方，
 * 因为分是人填的（第 1 条：只计算不判定，规则原文一律不解析）。
 */
export async function getProjectPerformanceRules() {
  const year = await currentPerfYear();
  if (year == null) return [];

  const rows = await prisma.perfCategory.findMany({
    where: { year, isActive: true, minorCategory: { in: [...PROJECT_PERF_MINORS] } },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      year: true,
      majorCategory: true,
      minorCategory: true,
      baseRule: true,
      nationalRule: true,
      provincialRule: true,
      cityRule: true,
      schoolRule: true,
      collegeRule: true,
      remark: true,
    },
  });
  return rows;
}
