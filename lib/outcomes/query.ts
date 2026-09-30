import { AchievementUsage } from "@/lib/generated/prisma/enums";
import {
  defaultPromotionDeclareYear,
  parsePromotionDeclareYear,
  promotionDeclareYearOptions,
} from "@/lib/promotion";
import {
  isOutcomeTypeFilter,
  type LedgerScope,
  type OutcomeFilters,
  type OutcomeTypeFilter,
} from "@/lib/outcomes/filters";

export type OutcomeSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type OutcomeQueryKey =
  | "scope"
  | "type"
  | "year"
  | "pmajor"
  | "pminor"
  | "major"
  | "minor"
  | "usage"
  | "needslink"
  | "unverified"
  | "dyear"
  | "group";

export type OutcomeQueryPatch = Partial<
  Record<OutcomeQueryKey, string | null>
>;

export type OutcomeQueryFilters = Required<
  Pick<
    OutcomeFilters,
    | "scope"
    | "type"
    | "year"
    | "promotionMajor"
    | "promotionMinor"
    | "major"
    | "minor"
    | "usage"
    | "needsLinkOnly"
    | "unverifiedOnly"
  >
>;

export type OutcomeQueryState = {
  filters: OutcomeQueryFilters;
  yearParam: string | null;
  declareYear: number;
  declareYearOptions: readonly number[];
  /**
   * 列表要不要按分类分组。**不是筛选**——不进 `anyFilter`、不被「清除筛选」带走，
   * 它只决定同一批行怎么排布。默认分组，`group=none` 才平铺
   */
  grouped: boolean;
  anyFilter: boolean;
  canonicalParams: URLSearchParams;
  canonicalPath: string;
  currentYear: number;
};

function scalar(
  params: OutcomeSearchParams,
  key: OutcomeQueryKey,
): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function parseScope(value: string | null): LedgerScope {
  if (value === "performance" || value === "all") return value;
  return "promotion";
}

function parseOutcomeType(value: string | null): OutcomeTypeFilter | null {
  return isOutcomeTypeFilter(value) ? value : null;
}

function parseYear(value: string | null): number | "none" | null {
  if (value === "none") return "none";
  if (!value || !/^(?:19|20|21)\d{2}$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function parseUsage(value: string | null): AchievementUsage | null {
  if (value === AchievementUsage.PERFORMANCE) {
    return AchievementUsage.PERFORMANCE;
  }
  if (value === AchievementUsage.PROMOTION) {
    return AchievementUsage.PROMOTION;
  }
  if (value === AchievementUsage.PROJECT_CLOSING) {
    return AchievementUsage.PROJECT_CLOSING;
  }
  return null;
}

function category(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function append(
  params: URLSearchParams,
  key: OutcomeQueryKey,
  value: string | null,
) {
  if (value) params.set(key, value);
}

export function parseOutcomeQuery(
  params: OutcomeSearchParams,
  context: { currentYear?: number } = {},
): OutcomeQueryState {
  const currentYear = context.currentYear ?? new Date().getFullYear();
  // 和导出页的职称表共用一份（lib/promotion.ts），两处默认值必须一样
  const declareYearOptions = promotionDeclareYearOptions(currentYear);
  const defaultDeclareYear = defaultPromotionDeclareYear(currentYear);

  const scope = parseScope(scalar(params, "scope"));
  const type = parseOutcomeType(scalar(params, "type"));
  const year = parseYear(scalar(params, "year"));
  const promotionMajor =
    scope === "promotion" ? category(scalar(params, "pmajor")) : null;
  const promotionMinor = promotionMajor
    ? category(scalar(params, "pminor"))
    : null;
  const major =
    scope === "performance" || scope === "all"
      ? category(scalar(params, "major"))
      : null;
  const minor = major ? category(scalar(params, "minor")) : null;
  const usage = parseUsage(scalar(params, "usage"));
  const needsLinkOnly = scalar(params, "needslink") === "1";
  const unverifiedOnly = scalar(params, "unverified") === "1";
  const declareYear = parsePromotionDeclareYear(scalar(params, "dyear"), currentYear);
  const grouped = scalar(params, "group") !== "none";

  const filters: OutcomeQueryFilters = {
    scope,
    type,
    year,
    promotionMajor,
    promotionMinor,
    major,
    minor,
    usage,
    needsLinkOnly,
    unverifiedOnly,
  };
  const canonicalParams = new URLSearchParams();
  if (scope !== "promotion") canonicalParams.set("scope", scope);
  append(canonicalParams, "type", type);
  if (year != null) canonicalParams.set("year", String(year));
  append(canonicalParams, "pmajor", promotionMajor);
  append(canonicalParams, "pminor", promotionMinor);
  append(canonicalParams, "major", major);
  append(canonicalParams, "minor", minor);
  if (usage) canonicalParams.set("usage", usage);
  if (needsLinkOnly) canonicalParams.set("needslink", "1");
  if (unverifiedOnly) canonicalParams.set("unverified", "1");
  if (declareYear !== defaultDeclareYear) {
    canonicalParams.set("dyear", String(declareYear));
  }
  if (!grouped) canonicalParams.set("group", "none");

  const search = canonicalParams.toString();
  return {
    filters,
    yearParam: year == null ? null : String(year),
    declareYear,
    declareYearOptions,
    grouped,
    anyFilter: Boolean(
      type ||
        year != null ||
        promotionMajor ||
        promotionMinor ||
        major ||
        minor ||
        usage ||
        needsLinkOnly ||
        unverifiedOnly,
    ),
    canonicalParams,
    canonicalPath: search
      ? `/achievements?${search}`
      : "/achievements",
    currentYear,
  };
}

export function outcomeHrefWith(
  state: OutcomeQueryState,
  patch: OutcomeQueryPatch,
): string {
  const params: OutcomeSearchParams = Object.fromEntries(
    state.canonicalParams.entries(),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete params[key];
    else params[key] = value;
  }
  return parseOutcomeQuery(params, {
    currentYear: state.currentYear,
  }).canonicalPath;
}

export function shouldRenderMissingYearFacet(
  state: OutcomeQueryState,
  missingYearCount: number,
): boolean {
  return missingYearCount > 0 || state.filters.year === "none";
}
