import {
  matchingPerformanceEntries,
  normalizeOutcomeFilters,
  sumNumericScore,
  type OutcomeFilters,
} from "@/lib/outcomes/filters";
import type { PerformanceEntry, UnifiedOutcomeRow } from "@/lib/outcomes/types";
import { compareIndicatorCode } from "@/lib/promotion";

/**
 * 成果页列表的分组。
 *
 * 「全部 + 2026」一选就是几十行平铺，用户得一行行读「绩效分类」那一列才知道
 * 哪几条是一类。分组只是**把同一份 `filtered` 换个排布**：不筛掉任何一行、
 * 不改任何数，各组小计加起来必须等于页面上那条合计。
 *
 * 分到哪一维跟着口径走，不另给用户一个「按什么分」的选择——
 * 职称口径下一条记录的坐标就是职称指标，绩效和「全部」口径下是绩效分类
 * （CLAUDE.md 第 11 条：两张分类表是两套坐标系，这里不混用也不互推）。
 * 已经按大类筛过了就往下一层分小类；连小类都选定了，再分组就是一个组，不分。
 */
export type OutcomeGroupDimension =
  | "performanceMajor"
  | "performanceMinor"
  | "promotionMajor"
  | "promotionMinor";

/**
 * 渲染某一组里的行时，把该行的绩效事项收窄到这一组。
 *
 * 一个课题可以在两个大类下各有一条事项（课题申报在「科研」、培训到账在「社会服务」），
 * 它会在两组里各出现一次；每一处只该印属于这一组的事项和分，
 * 否则同一个分会被两个组的小计各数一遍。`value: null` = 没挂绩效分类的那些事项。
 */
export type PerformanceEntryGroup = {
  dimension: "major" | "minor";
  value: string | null;
};

export function entryInGroup(
  entry: PerformanceEntry,
  group: PerformanceEntryGroup,
): boolean {
  const category = entry.perfCategory;
  if (group.value == null) return category == null;
  if (category == null) return false;
  return group.dimension === "major"
    ? category.majorCategory === group.value
    : category.minorCategory === group.value;
}

export type OutcomeGroup<T extends UnifiedOutcomeRow = UnifiedOutcomeRow> = {
  /** 组内唯一、可当 React key。未分类那一组是 `UNCATEGORIZED_GROUP_KEY` */
  key: string;
  label: string;
  rows: T[];
  /** 小计。绩效维度 = 本组事项的申报分；职称维度 = 本组各行的职称分 */
  score: number;
  /** 绩效维度才有：渲染本组的行时交给 view-model 收窄事项。职称维度为 null */
  entryGroup: PerformanceEntryGroup | null;
};

export const UNCATEGORIZED_GROUP_KEY = "__uncategorized__";

export type OutcomeGroupOrder = {
  /** 绩效对照表的大类顺序（学校那张表的行序） */
  performanceMajors: readonly string[];
  /** 同上，小类顺序 */
  performanceMinors: readonly string[];
  /** 职称量化表的一级指标顺序 */
  promotionMajors: readonly string[];
};

/**
 * 组的先后顺序取自**学校那两张表的行序**，不按条数排。
 *
 * 条数排序会让同一个组每换个年度就跳一次位置，而绩效表和职称量化表的行序
 * 正是用户填报时从上往下走的顺序。两份顺序都从页面已经取回的下拉选项里派生，
 * **不另外查库**（`getPerfOptions` / `getPromotionMajorOrder` 都按 sortOrder 排好了）。
 */
export function outcomeGroupOrderFrom(
  perfOptions: ReadonlyArray<{ majorCategory: string; minorCategory: string }>,
  promotionMajors: readonly string[],
): OutcomeGroupOrder {
  const majors: string[] = [];
  const minors: string[] = [];
  for (const option of perfOptions) {
    if (!majors.includes(option.majorCategory)) majors.push(option.majorCategory);
    if (!minors.includes(option.minorCategory)) minors.push(option.minorCategory);
  }
  return {
    performanceMajors: majors,
    performanceMinors: minors,
    promotionMajors,
  };
}

export function outcomeGroupDimension(
  filters: OutcomeFilters,
): OutcomeGroupDimension | null {
  const normalized = normalizeOutcomeFilters(filters);
  if (normalized.scope === "promotion") {
    if (normalized.promotionMinor) return null;
    return normalized.promotionMajor ? "promotionMinor" : "promotionMajor";
  }
  if (normalized.minor) return null;
  return normalized.major ? "performanceMinor" : "performanceMajor";
}

const collator = new Intl.Collator("zh-CN", { numeric: true });

/** 表里有的按表序，表里没有的（往年的旧分类）排在后面按字面序，未分类永远最后 */
function orderIndex(order: readonly string[], value: string): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function compareByOrder(order: readonly string[]) {
  return (a: string, b: string) =>
    orderIndex(order, a) - orderIndex(order, b) || collator.compare(a, b);
}

type Bucket<T> = {
  key: string;
  label: string;
  sortValue: string;
  rows: T[];
  scores: unknown[];
  entryGroup: PerformanceEntryGroup | null;
};

function bucketOf<T>(
  buckets: Map<string, Bucket<T>>,
  seed: Omit<Bucket<T>, "rows" | "scores">,
): Bucket<T> {
  let bucket = buckets.get(seed.key);
  if (!bucket) {
    bucket = { ...seed, rows: [], scores: [] };
    buckets.set(seed.key, bucket);
  }
  return bucket;
}

function finish<T extends UnifiedOutcomeRow>(
  buckets: Map<string, Bucket<T>>,
  compare: (a: string, b: string) => number,
): OutcomeGroup<T>[] {
  return [...buckets.values()]
    .sort((a, b) => {
      if (a.key === UNCATEGORIZED_GROUP_KEY) return 1;
      if (b.key === UNCATEGORIZED_GROUP_KEY) return -1;
      return compare(a.sortValue, b.sortValue);
    })
    .map(({ key, label, rows, scores, entryGroup }) => ({
      key,
      label,
      rows,
      score: sumNumericScore(scores),
      entryGroup,
    }));
}

function groupByPromotion<T extends UnifiedOutcomeRow>(
  rows: T[],
  dimension: "promotionMajor" | "promotionMinor",
  order: OutcomeGroupOrder,
): OutcomeGroup<T>[] {
  const buckets = new Map<string, Bucket<T>>();
  for (const row of rows) {
    const category = row.promotionCategory;
    const bucket = bucketOf(
      buckets,
      category == null
        ? {
            key: UNCATEGORIZED_GROUP_KEY,
            label: "未挂职称指标",
            sortValue: "",
            entryGroup: null,
          }
        : dimension === "promotionMajor"
          ? {
              key: category.majorIndicator,
              label: category.majorIndicator,
              sortValue: category.majorIndicator,
              entryGroup: null,
            }
          : {
              key: category.code,
              // 编号在前：申报表和材料目录都按「5.2」来（lib/promotion.ts）
              label: `${category.code} ${category.minorIndicator}`,
              sortValue: category.code,
              entryGroup: null,
            },
    );
    bucket.rows.push(row);
    bucket.scores.push(row.promotionScore);
  }
  return finish(
    buckets,
    dimension === "promotionMajor"
      ? compareByOrder(order.promotionMajors)
      : compareIndicatorCode,
  );
}

function groupByPerformance<T extends UnifiedOutcomeRow>(
  rows: T[],
  filters: OutcomeFilters,
  dimension: "performanceMajor" | "performanceMinor",
  order: OutcomeGroupOrder,
): OutcomeGroup<T>[] {
  const entryDimension = dimension === "performanceMajor" ? "major" : "minor";
  const buckets = new Map<string, Bucket<T>>();

  for (const row of rows) {
    const entries = matchingPerformanceEntries(row, filters);
    // 同一行在同一组里只出现一次；它在这一组里的几条事项的分都记进小计
    const placed = new Set<string>();
    const place = (value: string | null, scores: unknown[]) => {
      const key = value ?? UNCATEGORIZED_GROUP_KEY;
      const bucket = bucketOf(buckets, {
        key,
        label: value ?? "未挂绩效分类",
        sortValue: value ?? "",
        entryGroup: { dimension: entryDimension, value },
      });
      if (!placed.has(key)) {
        placed.add(key);
        bucket.rows.push(row);
      }
      bucket.scores.push(...scores);
    };

    // 「全部」口径下一行可以一条命中的事项都没有（靠职称年度进来的）——
    // 它照样得有个去处，不能因为分组就从列表里消失
    if (entries.length === 0) {
      place(null, []);
      continue;
    }
    for (const entry of entries) {
      const category = entry.perfCategory;
      place(
        category == null
          ? null
          : entryDimension === "major"
            ? category.majorCategory
            : category.minorCategory,
        [entry.declaredScore],
      );
    }
  }

  const groups = finish(
    buckets,
    compareByOrder(
      dimension === "performanceMajor"
        ? order.performanceMajors
        : order.performanceMinors,
    ),
  );
  if (dimension === "performanceMinor") return groups;

  // 大类组内按小类的表序聚拢（同一小类的挨在一起），其余保持传入顺序——
  // Array.prototype.sort 是稳定的，年度新的在前那条规矩不会被打乱
  const minorIndex = (row: T, group: OutcomeGroup<T>): number => {
    if (group.entryGroup == null) return 0;
    const indexes = matchingPerformanceEntries(row, filters)
      .filter((entry) => entryInGroup(entry, group.entryGroup!))
      .map((entry) =>
        entry.perfCategory == null
          ? order.performanceMinors.length
          : orderIndex(order.performanceMinors, entry.perfCategory.minorCategory),
      );
    return indexes.length === 0 ? order.performanceMinors.length : Math.min(...indexes);
  };
  return groups.map((group) => ({
    ...group,
    rows: [...group.rows].sort(
      (a, b) => minorIndex(a, group) - minorIndex(b, group),
    ),
  }));
}

/**
 * 把已经筛好的行分组。`filters` 必须和筛出 `rows` 的那份是同一份——
 * 命中哪些绩效事项由它决定，两边对不上小计就和合计对不上。
 * 返回 null = 当前筛选下不该分组（小类已经选定）。
 */
export function groupOutcomes<T extends UnifiedOutcomeRow>(
  rows: T[],
  filters: OutcomeFilters,
  order: OutcomeGroupOrder,
): OutcomeGroup<T>[] | null {
  const dimension = outcomeGroupDimension(filters);
  if (dimension == null) return null;
  if (dimension === "promotionMajor" || dimension === "promotionMinor") {
    return groupByPromotion(rows, dimension, order);
  }
  return groupByPerformance(rows, filters, dimension, order);
}
