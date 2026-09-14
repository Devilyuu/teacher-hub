/**
 * 职称量化口径的纯逻辑（人事处《业绩量化考核表》）。
 *
 * 与绩效口径（lib/achievement-filters.ts、PerfCategory）**并行且互不推导**——
 * CLAUDE.md 第 11 条：两张表各自随主管部门改版，写映射函数一改就烂。
 * 本文件里没有、将来也不要有「绩效大类 → 职称指标」这种函数。
 *
 * 不碰数据库，单测在同名 .test.ts。
 */
import type { TitleSeries } from "@/lib/generated/prisma/enums";

export type PromotionOption = {
  id: string;
  /** 二级指标编号，如 "5.2" */
  code: string;
  majorIndicator: string;
  minorIndicator: string;
  cap: number | null;
};

/** 「5.2」→ [5, 2]。4.10 必须排在 4.9 之后，字符串排序会排错 */
export function parseIndicatorCode(code: string): [number, number] {
  const [major, minor] = code.split(".");
  return [Number(major), Number(minor)];
}

export function compareIndicatorCode(a: string, b: string): number {
  const [am, an] = parseIndicatorCode(a);
  const [bm, bn] = parseIndicatorCode(b);
  return am - bm || an - bn;
}

/**
 * 下拉里显示的文案。**编号必须在前**——申报表、材料目录、跟人事处沟通
 * 全都按「5.2」这个编号来，名称反而是次要的。
 */
export function promotionOptionLabel(option: Pick<PromotionOption, "code" | "minorIndicator">) {
  return `${option.code} ${option.minorIndicator}`;
}

/** 按一级指标分组，供原生 select 的 optgroup 用。组内按编号排 */
export function groupByMajorIndicator(
  options: PromotionOption[],
): Array<{ majorIndicator: string; items: PromotionOption[] }> {
  const groups = new Map<string, PromotionOption[]>();
  for (const option of options) {
    groups.set(option.majorIndicator, [...(groups.get(option.majorIndicator) ?? []), option]);
  }
  return [...groups.entries()]
    .map(([majorIndicator, items]) => ({
      majorIndicator,
      items: [...items].sort((a, b) => compareIndicatorCode(a.code, b.code)),
    }))
    .sort((a, b) => compareIndicatorCode(a.items[0].code, b.items[0].code));
}

/**
 * 课题能挂的职称指标：5.2 纵向课题 / 5.3 横向项目和知识产权。
 *
 * **只做过滤，不做自动匹配。** 「纵向 → 5.2」看着理所当然，但那就是
 * 第 11 条禁止的映射函数——人事处哪年把这两格合并或拆细，函数就开始骗人。
 * 界面只把这两项摆出来，选哪个由人点。
 */
export const PROJECT_INDICATOR_CODES = ["5.2", "5.3"] as const;

export function projectIndicatorOptions(options: PromotionOption[]): PromotionOption[] {
  return options
    .filter((option) => (PROJECT_INDICATOR_CODES as readonly string[]).includes(option.code))
    .sort((a, b) => compareIndicatorCode(a.code, b.code));
}

const SERIES_LABELS: Record<TitleSeries, string> = {
  TEACHER: "教师系列",
  LAB: "实验系列",
  IDEOLOGY: "思政系列",
  EDU_ADMIN: "教管系列",
};

export function seriesLabel(series: TitleSeries) {
  return SERIES_LABELS[series];
}

/**
 * 「任现职以来」的时间窗（附件2 说明第 2 条）：
 * 起点是取得现职称之日，终点是**申报年度上一年的 12 月 31 日**。
 *
 * 终点不是"今天"：2026 年申报，算到 2025-12-31 为止，
 * 2026 年新出的成果得留到下一次。这条一错，导出的量化表就会多算一年。
 *
 * @param since 取得现职称之日；为 null 表示档案没填，此时不做时间过滤
 * @param declareYear 申报年度
 */
export type PromotionWindow = {
  /** 取得现职称之日。null 表示档案没填，此时只卡上限 */
  from: Date | null;
  /** 算到这一年的 12-31 为止 */
  toYear: number;
};

export function promotionWindow(since: Date | null, declareYear: number): PromotionWindow {
  return { from: since, toYear: declareYear - 1 };
}

/**
 * 一条成果是否落在职称量化的时间窗内。
 *
 * **年度未填时算落在窗内。** 库里 16 条老存量没有 year，把它们判成"超窗"
 * 会让人以为没这回事；判成"在窗内"最多是多看几条，梳理时顺手就补了年度。
 * 这是「校验只提示不阻止」在筛选上的同一条思路。
 */
export function inPromotionWindow(
  achievement: { year: number | null },
  window: PromotionWindow,
): boolean {
  if (achievement.year == null) return true;
  if (achievement.year > window.toYear) return false;
  if (window.from == null) return true;
  return achievement.year >= window.from.getUTCFullYear();
}
