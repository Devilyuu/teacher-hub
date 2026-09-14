import type { AchievementUsage } from "@/lib/generated/prisma/enums";
import {
  filterOutcomes,
  matchesOutcomeFilters,
  matchingPerformanceEntries,
  OUTCOME_TYPE_ORDER,
  outcomeTypeValue,
  type LedgerScope,
  type OutcomeFilters,
  type OutcomeTypeFilter,
} from "@/lib/outcomes/filters";
import type { PerformanceEntry, UnifiedOutcomeRow } from "@/lib/outcomes/types";
import { compareIndicatorCode, type PromotionWindow } from "@/lib/promotion";

export type Facet<TValue> = { value: TValue; count: number };

/**
 * 分面计数的上下文。
 *
 * **`year` 在这里是必须的。** 选了 2026 之后，绩效大类、职称指标、用途这些分面
 * 都要跟着只数 2026 的；不带年度就会出现「列表只剩 2026 的几条，底下的大类却还
 * 是全部年份的一长串」，用户点进去是空的。
 *
 * 唯一不套年度的是**年度分面自己**——facet 不筛自己那一维，
 * 否则选中 2026 之后别的年份全消失，就再也切不回去了。
 */
type FacetContext = Pick<OutcomeFilters, "scope" | "window" | "year">;

/** 年度分面自己的上下文：把 year 摘掉 */
function withoutYear(context: FacetContext): FacetContext {
  return { scope: context.scope, window: context.window };
}

/**
 * 参与计数的行。
 *
 * 直接复用 `matchesOutcomeFilters`，不再自己写一份口径判断——
 * 口径 + 窗口 + 年度这三者怎么组合，规则只该有一处
 * （之前这里是独立实现，年度那一维就是在这漏掉的）。
 * 刻意只传口径三件套：分类维度由各分面自己处理，
 * 传进来会让分面把自己那一维也筛掉。
 */
function scopeCandidates(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
): UnifiedOutcomeRow[] {
  return rows.filter((row) =>
    matchesOutcomeFilters(row, {
      scope: context.scope,
      window: context.window,
      year: context.year,
    }),
  );
}

/**
 * 该行在当前年度下、且挂了绩效分类的那些事项。
 *
 * 一行可以有多个年度的绩效事项（一个课题立项在 2025、结题在 2026）。
 * 只筛行不筛事项的话，选 2026 时那条 2025 的事项仍会把它的大类算进去。
 */
function categorizedEntries(
  row: UnifiedOutcomeRow,
  context: FacetContext,
): PerformanceEntry[] {
  return matchingPerformanceEntries(row, {
    // scope 固定成 performance 是为了让 requireCategory 生效：
    // 没挂分类的事项本来就不该出现在绩效分类分面里
    scope: "performance",
    year: context.year,
  });
}

/** 选中的值即使在当前年度下是 0 条也要留着，否则筛选还生效却没有任何 chip 高亮 */
function withActiveFacet<T extends Facet<string>>(
  facets: T[],
  active: string | null | undefined,
  make: (value: string) => T,
): T[] {
  if (!active || facets.some((facet) => facet.value === active)) return facets;
  return [...facets, make(active)];
}

function yearsForScope(
  row: UnifiedOutcomeRow,
  scope: LedgerScope,
): Array<number | null> {
  if (scope === "promotion") return [row.promotionYear];
  if (scope === "performance") {
    return row.performanceEntries
      .filter((entry) => entry.perfCategory != null)
      .map((entry) => entry.year);
  }
  return [
    row.promotionYear,
    ...row.performanceEntries.map((entry) => entry.year),
  ];
}

export function yearFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
): Facet<number>[] {
  const scope = context.scope ?? "all";
  const counts = new Map<number, number>();
  // 年度分面不套年度筛选：套了就只剩选中的那一年，切不回别的年份
  for (const row of scopeCandidates(rows, withoutYear(context))) {
    const rowYears = new Set(
      yearsForScope(row, scope).filter((year): year is number => year != null),
    );
    for (const year of rowYears) {
      counts.set(year, (counts.get(year) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.value - a.value);
}

export function missingYearCount(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
): number {
  const scope = context.scope ?? "all";
  // 「未填年度」也是年度分面的一格，同样不套年度筛选
  return scopeCandidates(rows, withoutYear(context)).filter((row) =>
    yearsForScope(row, scope).some((year) => year == null),
  ).length;
}

/**
 * 类型分面。**按枚举声明序排，不按条数降序**——「论文 / 研究报告 / 教材…」
 * 是一张固定的清单，顺序稳定才能盲点；条数排序会让同一个 chip 每换个年度
 * 就跳一次位置。零条的类型直接不出现（14 个类型全摆出来等于没筛）。
 */
export function typeFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
  active?: OutcomeTypeFilter | null,
): Facet<OutcomeTypeFilter>[] {
  const counts = new Map<OutcomeTypeFilter, number>();
  for (const row of scopeCandidates(rows, context)) {
    const value = outcomeTypeValue(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const facets = OUTCOME_TYPE_ORDER.filter((value) => counts.has(value)).map(
    (value) => ({ value, count: counts.get(value) ?? 0 }),
  );
  return withActiveFacet(facets, active, (value) => ({
    value: value as OutcomeTypeFilter,
    count: 0,
  }));
}

export function performanceMajorFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
  active?: string | null,
): Facet<string>[] {
  const counts = new Map<string, number>();
  for (const row of scopeCandidates(rows, context)) {
    const rowValues = new Set(
      categorizedEntries(row, context)
        .map((entry) => entry.perfCategory?.majorCategory)
        .filter((value): value is string => Boolean(value)),
    );
    for (const value of rowValues) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const facets = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh"));
  return withActiveFacet(facets, active, (value) => ({ value, count: 0 }));
}

export function performanceMinorFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
  major: string | null | undefined,
  active?: string | null,
): Facet<string>[] {
  if (!major) return [];
  const counts = new Map<string, number>();
  for (const row of scopeCandidates(rows, context)) {
    const rowValues = new Set(
      categorizedEntries(row, context)
        .filter((entry) => entry.perfCategory?.majorCategory === major)
        .map((entry) => entry.perfCategory?.minorCategory)
        .filter((value): value is string => Boolean(value)),
    );
    for (const value of rowValues) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const facets = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh"));
  return withActiveFacet(facets, active, (value) => ({ value, count: 0 }));
}

/**
 * 职称口径按 `promotionYear` 对年度，和绩效那条完全独立
 * （CLAUDE.md 第 11 条：两张分类表是两套坐标系）。
 *
 * `scopeCandidates` 在「全部」口径下放行的条件是「职称年度命中**或**有命中的绩效
 * 事项」，所以这里必须再对一次 `promotionYear`——否则一条 2024 立项、2026 结题的
 * 课题，会在选 2026 时把它 2024 的职称指标算进来。
 */
function matchesPromotionYear(
  row: UnifiedOutcomeRow,
  year: OutcomeFilters["year"],
): boolean {
  if (year === "none") return row.promotionYear == null;
  if (typeof year === "number") return row.promotionYear === year;
  return true;
}

export function promotionMajorFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
  order: string[],
  active?: string | null,
): Facet<string>[] {
  const counts = new Map<string, number>();
  for (const row of scopeCandidates(rows, context)) {
    if (!matchesPromotionYear(row, context.year)) continue;
    const value = row.promotionCategory?.majorIndicator;
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const facets = order
    .filter((value) => counts.has(value))
    .map((value) => ({ value, count: counts.get(value) ?? 0 }));
  return withActiveFacet(facets, active, (value) => ({ value, count: 0 }));
}

export function promotionMinorFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
  major: string | null | undefined,
  active?: string | null,
): Array<Facet<string> & { label: string }> {
  if (!major) return [];
  const counts = new Map<string, { count: number; label: string }>();
  for (const row of scopeCandidates(rows, context)) {
    if (!matchesPromotionYear(row, context.year)) continue;
    const category = row.promotionCategory;
    if (!category || category.majorIndicator !== major) continue;
    const previous = counts.get(category.code);
    counts.set(category.code, {
      count: (previous?.count ?? 0) + 1,
      label: previous?.label ?? category.minorIndicator,
    });
  }
  const facets = [...counts.entries()]
    .map(([value, detail]) => ({ value, ...detail }))
    .sort((a, b) => compareIndicatorCode(a.value, b.value));
  // 选中的二级指标数为 0 时也要留着，但标签只有从数据里才拿得到，
  // 拿不到就退回显示编码——总比整条消失、筛选还生效着强
  return withActiveFacet(facets, active, (value) => ({
    value,
    count: 0,
    label: value,
  }));
}

export function usageFacets(
  rows: UnifiedOutcomeRow[],
  context: FacetContext,
): Facet<AchievementUsage>[] {
  const achievements = scopeCandidates(rows, context).filter(
    (row) => row.kind === "ACHIEVEMENT",
  );
  const order: AchievementUsage[] = [
    "PERFORMANCE",
    "PROMOTION",
    "PROJECT_CLOSING",
  ];
  return order.map((value) => ({
    value,
    count: achievements.filter((row) => row.usableFor.includes(value)).length,
  }));
}

export function outcomeScopeCounts(
  rows: UnifiedOutcomeRow[],
  window: PromotionWindow | null,
): Record<LedgerScope, number> {
  return {
    promotion: filterOutcomes(rows, { scope: "promotion", window }).length,
    performance: filterOutcomes(rows, { scope: "performance" }).length,
    all: rows.length,
  };
}

export function scoreWithoutPromotionCategoryCount(
  rows: UnifiedOutcomeRow[],
): number {
  return rows.filter(
    (row) => row.promotionScore != null && row.promotionCategory == null,
  ).length;
}

/** 有分却没挂一级指标的行，在堆叠条里归到这一档（放最后） */
export const PROMOTION_SCORE_UNCATEGORIZED = "未挂指标";

export type PromotionScoreSlice = { major: string; score: number };

/**
 * 职称量化分按一级指标的构成，喂给成果页顶部那条单色堆叠条。
 *
 * 传进来的必须是**筛选后的行**——条要和它上面的「职称量化分合计」、
 * 下面的表格说同一份数，自己再筛一遍就会分叉。
 *
 * - 一级指标按字典表的 1→6 排（同 promotionMajorFacets 的理由：
 *   人事处那张表的顺序有意义，打乱了对不上纸质申报表）
 * - 有分没挂指标的归「未挂指标」，摆在最后——这正是待核实要清的账，
 *   藏起来就没人清了
 * - 扣分（负分）不进条：堆叠条读的是「分从哪来」，负宽度画不出来，
 *   由 deducted 单独带出去让界面标注。因此 slices 之和 + deducted
 *   才等于合计，两者都显示才对得上账
 */
export function promotionScoreComposition(
  rows: UnifiedOutcomeRow[],
  order: string[],
): { slices: PromotionScoreSlice[]; deducted: number } {
  const sums = new Map<string, number>();
  let deducted = 0;
  for (const row of rows) {
    if (row.promotionScore == null) continue;
    const score = Number(row.promotionScore);
    if (!Number.isFinite(score) || score === 0) continue;
    if (score < 0) {
      deducted += score;
      continue;
    }
    const major =
      row.promotionCategory?.majorIndicator ?? PROMOTION_SCORE_UNCATEGORIZED;
    sums.set(major, (sums.get(major) ?? 0) + score);
  }

  const rank = (major: string) => {
    if (major === PROMOTION_SCORE_UNCATEGORIZED) return order.length + 1;
    const index = order.indexOf(major);
    return index === -1 ? order.length : index;
  };
  const slices = [...sums.entries()]
    .map(([major, score]) => ({ major, score }))
    .sort((a, b) => rank(a.major) - rank(b.major));
  return { slices, deducted };
}
