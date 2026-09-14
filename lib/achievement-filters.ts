/**
 * 成果台账的筛选与分面统计（prd-ledger 4）。
 *
 * 纯函数：一次取全库、在内存里筛。成果是几百条量级，
 * 为每个筛选组合各查一次数据库不划算，也让分面计数变复杂。
 */
import { compareIndicatorCode, type PromotionWindow } from "@/lib/promotion";
import type { AchievementUsage } from "@/lib/generated/prisma/enums";
import {
  LEDGER_SCOPE_LABELS,
  LEDGER_SCOPES,
  matchesOutcomeFilters,
  parseScope,
  sumNumericScore,
  type LedgerScope,
  type OutcomeFilters,
} from "@/lib/outcomes/filters";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";

// Task 5 才会把页面切到 UnifiedOutcomeRow；本文件暂时保留旧消费者 surface，
// scope 常量、解析与匹配行为只委托 lib/outcomes/filters 这一份实现。
export {
  LEDGER_SCOPE_LABELS,
  LEDGER_SCOPES,
  parseScope,
  type LedgerScope,
};

/** 列表里每行需要的最小形状。故意不依赖 Prisma 的完整类型，测试才好造数据 */
export type FilterableAchievement = {
  year: number | null;
  perfCategory: { majorCategory: string; minorCategory?: string } | null;
  /** 挂到人事处哪个二级指标上。null == 评职称用不上 */
  promotionCategoryId: string | null;
  /** 该指标属于哪个一级指标。职称口径的分面按它分组 */
  promotionCategory?: { majorIndicator: string; code?: string; minorIndicator?: string } | null;
  usableFor: AchievementUsage[];
  /**
   * 勾了「结题挂接」用途、却没挂到任何要求上。
   * **不是 `isUnlinked`**——多数成果本来就不属于任何课题，那不算漏
   * （见 lib/queries/achievements.ts 里 needsLink 的注释）
   */
  needsLink: boolean;
  isVerified: boolean;
};

export type AchievementFilters = OutcomeFilters;

function asUnifiedAchievement(item: FilterableAchievement): UnifiedOutcomeRow {
  const promotionCategory =
    item.promotionCategoryId == null
      ? null
      : {
          code: item.promotionCategory?.code ?? "",
          majorIndicator: item.promotionCategory?.majorIndicator ?? "",
          minorIndicator: item.promotionCategory?.minorIndicator ?? "",
        };
  const performanceEntries =
    item.year == null && item.perfCategory == null
      ? []
      : [
          {
            id: "legacy-achievement",
            year: item.year,
            isVerified: item.isVerified,
            declaredScore: null,
            perfCategory: item.perfCategory
              ? {
                  majorCategory: item.perfCategory.majorCategory,
                  minorCategory: item.perfCategory.minorCategory ?? "",
                }
              : null,
          },
        ];

  return {
    key: "ACHIEVEMENT:legacy-achievement",
    kind: "ACHIEVEMENT",
    id: "legacy-achievement",
    title: "",
    href: "/achievements/legacy-achievement",
    level: "UNRATED",
    promotionYear: item.year,
    promotionCategory,
    promotionScore: null,
    performanceEntries,
    schoolRewarded: false,
    attachmentCount: 0,
    achievementType: "OTHER",
    achievementStatus: "PLANNED",
    isVerified: item.isVerified,
    usableFor: item.usableFor,
    needsLink: item.needsLink,
    linkedProjects: [],
    tags: [],
    year: item.year,
    perfCategoryId: null,
    promotionCategoryId: item.promotionCategoryId,
    declaredScore: null,
    publishedAt: null,
    completedAt: null,
    datePrecision: "UNKNOWN",
    dateText: null,
  };
}

/**
 * 一条成果为什么没进职称口径。
 * 界面要把它显示出来——**默认视图藏掉几十条却不说理由，会让人以为数据丢了**。
 */
export type PromotionExclusion = "notCounted" | "outOfWindow" | null;

export function promotionExclusion(
  item: FilterableAchievement,
  window: PromotionWindow | null,
): PromotionExclusion {
  if (item.promotionCategoryId == null) return "notCounted";
  if (
    !matchesOutcomeFilters(asUnifiedAchievement(item), {
      scope: "promotion",
      window,
    })
  ) {
    return "outOfWindow";
  }
  return null;
}

/**
 * 填了职称分、却没挂职称指标。
 *
 * **填分不等于挂指标。** 职称口径过滤看的是 `promotionCategoryId` 有没有值，
 * 完全不看 `promotionScore`——所以只填了分、指标留在「不计入职称」的成果
 * 依然进不了职称口径。用户以为"设了职称分数"就算数了，界面却一声不吭。
 *
 * 这是个**软提示**：只标出来，不阻止保存也不自动补挂
 * （CLAUDE.md 第 1、3 条——挂哪个指标是人的判断，系统不许替他判）。
 */
export function hasScoreWithoutCategory(item: {
  promotionCategoryId: string | null;
  promotionScore: unknown;
}): boolean {
  return item.promotionCategoryId == null && item.promotionScore != null;
}

/** 上面那种情况有几条。界面把它写进「已隐去」那句里，给出梳理的入口 */
export function scoreWithoutCategoryCount(
  items: { promotionCategoryId: string | null; promotionScore: unknown }[],
): number {
  return items.filter(hasScoreWithoutCategory).length;
}

export function matchesScope(
  item: FilterableAchievement,
  scope: LedgerScope,
  window: PromotionWindow | null,
): boolean {
  return matchesOutcomeFilters(asUnifiedAchievement(item), { scope, window });
}

/**
 * **这里的 scope 默认是 `all`，不是 `promotion`。**
 * 「不传筛选就放行一切」是纯函数该有的样子；
 * 「默认看职称口径」是产品决定，放在 `parseScope`（读 URL 那一层）里。
 */
export function matchesFilters(
  item: FilterableAchievement,
  filters: AchievementFilters,
): boolean {
  return matchesOutcomeFilters(asUnifiedAchievement(item), filters);
}

/** 职称口径把哪些挡在外面了，按理由分组。界面据此写「另有 X 条…」 */
export function promotionExclusionCounts(
  items: FilterableAchievement[],
  window: PromotionWindow | null,
): { notCounted: number; outOfWindow: number } {
  let notCounted = 0;
  let outOfWindow = 0;
  for (const item of items) {
    const reason = promotionExclusion(item, window);
    if (reason === "notCounted") notCounted += 1;
    else if (reason === "outOfWindow") outOfWindow += 1;
  }
  return { notCounted, outOfWindow };
}

export function filterAchievements<T extends FilterableAchievement>(
  items: T[],
  filters: AchievementFilters,
): T[] {
  return items.filter((item) => matchesFilters(item, filters));
}

export type Facet<TValue> = { value: TValue; count: number };

/**
 * 年度分面。**降序**——年底填报时最关心当年和上一年，
 * 而没填年度的（老的 Obsidian 存量）排最后。
 */
export function yearFacets(items: FilterableAchievement[]): Facet<number>[] {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (item.year == null) continue;
    counts.set(item.year, (counts.get(item.year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.value - a.value);
}

/** 未填年度的条数。单独给出来，因为它是"待订正"的信号而不是一个正常年度 */
export function missingYearCount(items: FilterableAchievement[]): number {
  return items.filter((item) => item.year == null).length;
}

/**
 * 大类分面。按条数降序——学校那 11 个大类里，本人只用到其中几个，
 * 按表格原顺序排会让空大类占着位置。
 */
export function majorFacets(items: FilterableAchievement[]): Facet<string>[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const major = item.perfCategory?.majorCategory;
    if (!major) continue;
    counts.set(major, (counts.get(major) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh"));
}

/**
 * 绩效小类分面。**只统计选定大类下的**——不传大类就返回空，
 * 因为几十个小类一次摆出来等于没筛。
 *
 * 与大类分面一样按条数降序：学校的表里一个人通常只用到其中一小部分，
 * 按表格原顺序排会让空小类占着位置。
 */
export function minorFacets(
  items: FilterableAchievement[],
  major: string | null | undefined,
): Facet<string>[] {
  if (!major) return [];
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.perfCategory?.majorCategory !== major) continue;
    const minor = item.perfCategory?.minorCategory;
    if (!minor) continue;
    counts.set(minor, (counts.get(minor) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh"));
}

/**
 * 职称二级指标分面，与 minorFacets 对称。**按编号排序**（5.2 在 5.10 前），
 * 理由同一级指标：人事处那张表的编号是业务键，打乱了就和纸质申报表对不上号。
 */
export function promotionMinorFacets(
  items: FilterableAchievement[],
  major: string | null | undefined,
): Array<Facet<string> & { label: string }> {
  if (!major) return [];
  const counts = new Map<string, { count: number; label: string }>();
  for (const item of items) {
    if (item.promotionCategory?.majorIndicator !== major) continue;
    const code = item.promotionCategory?.code;
    if (!code) continue;
    const prev = counts.get(code);
    counts.set(code, {
      count: (prev?.count ?? 0) + 1,
      label: prev?.label ?? item.promotionCategory?.minorIndicator ?? code,
    });
  }
  return [...counts.entries()]
    .map(([value, { count, label }]) => ({ value, count, label }))
    .sort((a, b) => compareIndicatorCode(a.value, b.value));
}

/**
 * 职称一级指标分面。**按 1→6 的原顺序排，不按条数降序。**
 * 和绩效大类不同：人事处那张表的顺序是有意义的（思政在最前、科研在 5），
 * 打乱了就和纸质申报表对不上号。
 */
export function promotionMajorFacets(
  items: FilterableAchievement[],
  /** 一级指标的正序，由字典表给出 */
  order: string[],
): Facet<string>[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const major = item.promotionCategory?.majorIndicator;
    if (!major) continue;
    counts.set(major, (counts.get(major) ?? 0) + 1);
  }
  return order
    .filter((value) => counts.has(value))
    .map((value) => ({ value, count: counts.get(value) ?? 0 }));
}

export function usageFacets(items: FilterableAchievement[]): Facet<AchievementUsage>[] {
  const order: AchievementUsage[] = ["PERFORMANCE", "PROMOTION", "PROJECT_CLOSING"];
  return order.map((value) => ({
    value,
    count: items.filter((item) => item.usableFor.includes(value)).length,
  }));
}

/**
 * 申报分合计。**只在筛出的这批上算**——年底填报时筛出某年度，
 * 想看的就是那一年的合计。
 *
 * 分值可能是 Prisma 的 Decimal，转成 number 再加；null 当 0。
 */
export function sumDeclaredScore(items: { declaredScore: unknown }[]): number {
  return sumNumericScore(items.map((item) => item.declaredScore));
}

/**
 * 职称量化分合计。**与申报分是两套口径的分，绝不能相加或互相赋值**——
 * 前者是人事处评职称的量化表，后者是二级学院分钱的表。
 */
export function sumPromotionScore(items: { promotionScore: unknown }[]): number {
  return sumNumericScore(items.map((item) => item.promotionScore));
}
