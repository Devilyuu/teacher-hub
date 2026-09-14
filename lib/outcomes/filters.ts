import {
  AchievementType,
  type AchievementUsage,
} from "@/lib/generated/prisma/enums";
import { inPromotionWindow, type PromotionWindow } from "@/lib/promotion";
import type { PerformanceEntry, UnifiedOutcomeRow } from "@/lib/outcomes/types";

export type LedgerScope = "promotion" | "performance" | "all";

export const LEDGER_SCOPES: LedgerScope[] = ["promotion", "performance", "all"];

export const LEDGER_SCOPE_LABELS: Record<LedgerScope, string> = {
  promotion: "职称口径",
  performance: "绩效口径",
  all: "全部",
};

export function parseScope(value: string | null | undefined): LedgerScope {
  return (LEDGER_SCOPES as string[]).includes(value ?? "")
    ? (value as LedgerScope)
    : "promotion";
}

/**
 * 「类型」这一维。**课题也是一档**——成果页是 Project + Achievement 的联合视图
 * （CLAUDE.md 第 10 条），表格「类型」列本来就把课题和论文、专利并排印在一起，
 * 筛选跟着列走才不会出现「列里有这个值、筛选条里找不到」。
 * `AchievementType` 里没有 `PROJECT`，两者拼一起不会撞值。
 */
export type OutcomeTypeFilter = "PROJECT" | AchievementType;

export const OUTCOME_TYPE_ORDER: OutcomeTypeFilter[] = [
  "PROJECT",
  ...Object.values(AchievementType),
];

export function isOutcomeTypeFilter(
  value: string | null | undefined,
): value is OutcomeTypeFilter {
  return (OUTCOME_TYPE_ORDER as string[]).includes(value ?? "");
}

/** 一行在「类型」这一维上的取值。分面计数和筛选共用，两处不许各算各的 */
export function outcomeTypeValue(row: UnifiedOutcomeRow): OutcomeTypeFilter {
  return row.kind === "PROJECT" ? "PROJECT" : row.achievementType;
}

export type OutcomeFilters = {
  scope?: LedgerScope;
  type?: OutcomeTypeFilter | null;
  window?: PromotionWindow | null;
  year?: number | "none" | null;
  major?: string | null;
  minor?: string | null;
  promotionMajor?: string | null;
  promotionMinor?: string | null;
  usage?: AchievementUsage | null;
  needsLinkOnly?: boolean;
  unverifiedOnly?: boolean;
};

export type NormalizedOutcomeFilters = Omit<OutcomeFilters, "scope"> & {
  scope: LedgerScope;
};

export function normalizeOutcomeFilters(
  filters: OutcomeFilters,
): NormalizedOutcomeFilters {
  const scope = filters.scope ?? "all";
  const common = {
    type: filters.type,
    year: filters.year,
    usage: filters.usage,
    needsLinkOnly: filters.needsLinkOnly,
    unverifiedOnly: filters.unverifiedOnly,
  };

  if (scope === "promotion") {
    return {
      ...common,
      scope,
      window: filters.window,
      // 旧 achievement-filters 纯函数仍用 major/minor 传职称坐标；
      // 成果页 canonical query 只会传 promotionMajor/promotionMinor。
      promotionMajor: filters.promotionMajor ?? filters.major,
      promotionMinor: filters.promotionMinor ?? filters.minor,
    };
  }

  if (scope === "performance") {
    return {
      ...common,
      scope,
      major: filters.major,
      minor: filters.minor,
    };
  }

  return {
    ...common,
    scope,
    major: filters.major,
    minor: filters.minor,
    promotionMajor: filters.promotionMajor,
    promotionMinor: filters.promotionMinor,
  };
}

function matchesPromotionCategory(
  row: UnifiedOutcomeRow,
  major: string | null | undefined,
  minor: string | null | undefined,
): boolean {
  if (!major && !minor) return true;
  const category = row.promotionCategory;
  if (!category) return false;
  if (major && category.majorIndicator !== major) return false;
  if (minor && category.code !== minor && category.minorIndicator !== minor) return false;
  return true;
}

function matchesPerformanceEntry(
  entry: PerformanceEntry,
  filters: Pick<OutcomeFilters, "year" | "major" | "minor" | "unverifiedOnly">,
  requireCategory: boolean,
): boolean {
  if (requireCategory && entry.perfCategory == null) return false;
  if (filters.year === "none" && entry.year != null) return false;
  if (typeof filters.year === "number" && entry.year !== filters.year) return false;
  if (filters.major && entry.perfCategory?.majorCategory !== filters.major) return false;
  if (filters.minor && entry.perfCategory?.minorCategory !== filters.minor) return false;
  if (filters.unverifiedOnly && entry.isVerified) return false;
  return true;
}

/**
 * Return the child facts that satisfy every child-level condition together.
 *
 * Consumers must use this instead of independent `.some()` checks so a
 * categorized event cannot be combined with a different unverified event.
 */
export function matchingPerformanceEntries(
  row: UnifiedOutcomeRow,
  filters: OutcomeFilters,
): PerformanceEntry[] {
  const normalized = normalizeOutcomeFilters(filters);
  if (normalized.scope === "promotion") return row.performanceEntries;

  const requireCategory =
    normalized.scope === "performance" ||
    Boolean(normalized.major || normalized.minor);

  return row.performanceEntries.filter((entry) =>
    matchesPerformanceEntry(entry, normalized, requireCategory),
  );
}

function matchesPromotionCoordinate(
  row: UnifiedOutcomeRow,
  filters: Pick<OutcomeFilters, "year" | "major" | "minor">,
): boolean {
  if (filters.year === "none" && row.promotionYear != null) return false;
  if (typeof filters.year === "number" && row.promotionYear !== filters.year) {
    return false;
  }
  return matchesPromotionCategory(row, filters.major, filters.minor);
}

function matchesAllCoordinateFilters(
  row: UnifiedOutcomeRow,
  filters: Pick<
    NormalizedOutcomeFilters,
    | "scope"
    | "year"
    | "major"
    | "minor"
    | "promotionMajor"
    | "promotionMinor"
    | "unverifiedOnly"
  >,
): boolean {
  const hasPerformanceCategory = Boolean(filters.major || filters.minor);
  const hasPromotionCategory = Boolean(
    filters.promotionMajor || filters.promotionMinor,
  );

  if (
    hasPerformanceCategory &&
    matchingPerformanceEntries(row, filters).length === 0
  ) {
    return false;
  }

  if (
    hasPromotionCategory &&
    (((filters.year === "none" && row.promotionYear != null) ||
      (typeof filters.year === "number" &&
        row.promotionYear !== filters.year)) ||
      !matchesPromotionCategory(
        row,
        filters.promotionMajor,
        filters.promotionMinor,
      ))
  ) {
    return false;
  }

  if (!hasPerformanceCategory && !hasPromotionCategory && filters.year === "none") {
    return (
      row.promotionYear == null ||
      matchingPerformanceEntries(row, filters).length > 0
    );
  }

  if (
    !hasPerformanceCategory &&
    !hasPromotionCategory &&
    typeof filters.year === "number"
  ) {
    return (
      row.promotionYear === filters.year ||
      matchingPerformanceEntries(row, filters).length > 0
    );
  }

  return true;
}

function matchesVerificationFilter(
  row: UnifiedOutcomeRow,
  filters: NormalizedOutcomeFilters,
): boolean {
  if (!filters.unverifiedOnly) return true;
  if (row.kind === "ACHIEVEMENT") return !row.isVerified;
  if (filters.scope === "promotion") return false;
  return matchingPerformanceEntries(row, filters).length > 0;
}

export function matchesOutcomeFilters(
  row: UnifiedOutcomeRow,
  filters: OutcomeFilters,
): boolean {
  const normalized = normalizeOutcomeFilters(filters);
  const scope = normalized.scope;

  // 类型与口径正交：先按类型砍掉整行，剩下的再按口径和坐标判
  if (normalized.type && outcomeTypeValue(row) !== normalized.type) return false;

  if (scope === "promotion") {
    if (!row.promotionCategory) return false;
    if (
      normalized.year !== "none" &&
      normalized.window &&
      !inPromotionWindow({ year: row.promotionYear }, normalized.window)
    ) {
      return false;
    }
    if (
      !matchesPromotionCoordinate(row, {
        year: normalized.year,
        major: normalized.promotionMajor,
        minor: normalized.promotionMinor,
      })
    ) {
      return false;
    }
  } else if (scope === "performance") {
    if (matchingPerformanceEntries(row, normalized).length === 0) {
      return false;
    }
  } else if (!matchesAllCoordinateFilters(row, normalized)) {
    return false;
  }

  if (
    scope !== "performance" &&
    !matchesPromotionCategory(
      row,
      normalized.promotionMajor,
      normalized.promotionMinor,
    )
  ) {
    return false;
  }

  if (row.kind === "ACHIEVEMENT") {
    if (normalized.usage && !row.usableFor.includes(normalized.usage)) return false;
    if (normalized.needsLinkOnly && !row.needsLink) return false;
  }

  return matchesVerificationFilter(row, normalized);
}

export function filterOutcomes<T extends UnifiedOutcomeRow>(
  rows: T[],
  filters: OutcomeFilters,
): T[] {
  return rows.filter((row) => matchesOutcomeFilters(row, filters));
}

/** Prisma Decimal、number 与 null 共用的安全求和入口。 */
export function sumNumericScore(values: unknown[]): number {
  return values.reduce<number>((sum, value) => {
    if (value == null) return sum;
    const number = Number(value);
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

export function sumPromotionScore(rows: UnifiedOutcomeRow[]): number {
  return sumNumericScore(rows.map((row) => row.promotionScore));
}

export function sumPerformanceScore(
  rows: UnifiedOutcomeRow[],
  filters: OutcomeFilters,
): number {
  const normalized = normalizeOutcomeFilters(filters);
  return sumNumericScore(
    rows.flatMap((row) =>
      matchingPerformanceEntries(row, normalized)
        .map((entry) => entry.declaredScore),
    ),
  );
}

export function totals(
  rows: UnifiedOutcomeRow[],
  filters: OutcomeFilters,
): {
  count: number;
  sumPromotionScore: number;
  sumPerformanceScore: number;
} {
  const filtered = filterOutcomes(rows, filters);
  return {
    count: filtered.length,
    sumPromotionScore: sumPromotionScore(filtered),
    sumPerformanceScore: sumPerformanceScore(filtered, filters),
  };
}

export const outcomeTotals = totals;
