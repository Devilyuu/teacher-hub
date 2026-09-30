/**
 * 职称量化口径的纯逻辑（人事处《业绩量化考核表》）。
 *
 * 与绩效口径（PerfCategory，筛选口径在 lib/outcomes/filters.ts）**并行且互不推导**——
 * CLAUDE.md 第 11 条：两张表各自随主管部门改版，写映射函数一改就烂。
 * 本文件里没有、将来也不要有「绩效大类 → 职称指标」这种函数。
 *
 * 不碰数据库，单测在同名 .test.ts。
 */
import type { TitleSeries } from "@/lib/generated/prisma/enums";
import { projectEligibleOf } from "@/lib/project-eligibility";

export type PromotionOption = {
  id: string;
  /** 二级指标编号，如 "5.2" */
  code: string;
  majorIndicator: string;
  minorIndicator: string;
  cap: number | null;
  /** 赋分原文，课题表单选中后照原样摆在分值框上面。**不解析**（第 1 条） */
  scoringRule: string | null;
  /** 课题能不能挂这一项（分类表里人勾的），见 lib/project-eligibility.ts */
  projectEligible: boolean;
};

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 「三」→ 3、「十二」→ 12、「二十」→ 20。只认到九十九，指标编号用不到更大的 */
function chineseNumeral(text: string): number | null {
  if (text.length === 1 && text in CHINESE_DIGITS) return CHINESE_DIGITS[text]!;
  const match = /^([一二两三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(text);
  if (!match) return null;
  const tens = match[1] ? CHINESE_DIGITS[match[1]]! : 1;
  const ones = match[2] ? CHINESE_DIGITS[match[2]]! : 0;
  return tens * 10 + ones;
}

/** 编号拆成段：阿拉伯数字和中文数字按数值、其余按字符 */
function codeSegments(code: string): Array<number | string> {
  return [...code.trim().matchAll(/\d+|[零〇一二两三四五六七八九十]+|[^\d零〇一二两三四五六七八九十]+/g)].map(
    ([text]) => (/^\d+$/.test(text) ? Number(text) : (chineseNumeral(text) ?? text)),
  );
}

/**
 * 指标编号的自然序：4.9 在 4.10 前、A2 在 A10 前、（二）在（十）前。
 *
 * 原来只认「数字.数字」，拿「A1」「一、2」这种编号来比会得到 NaN，排序直接乱掉——
 * 别的学校的表编号五花八门（2026-09-27 放开编号格式时改的）。
 * 数字段排在文字段前面；段都一样时短的在前，最后按原串兜底，保证结果稳定。
 */
export function compareIndicatorCode(a: string, b: string): number {
  const left = codeSegments(a);
  const right = codeSegments(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index]!;
    const y = right[index]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return left.length - right.length || (a < b ? -1 : a > b ? 1 : 0);
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
 * 课题能挂的职称指标：分类表里勾了「课题可挂」的那几项，一项都没勾时是全部
 * （`projectEligibleOf`）。本校那两项是 5.2 纵向课题 / 5.3 横向项目和知识产权，
 * 迁移时照原来写死的名单勾好了。
 *
 * **只做过滤，不做自动匹配。** 「纵向 → 5.2」看着理所当然，但那就是
 * 第 11 条禁止的映射函数——人事处哪年把这两格合并或拆细，函数就开始骗人。
 * 界面只把候选摆出来，选哪个由人点。
 */
export function projectIndicatorOptions(options: PromotionOption[]): PromotionOption[] {
  return projectEligibleOf(options).sort((a, b) => compareIndicatorCode(a.code, b.code));
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
 * 可选的申报年度：今年、明年、后年，**默认明年**——多数时候是在为下一次申报攒东西。
 *
 * 成果页的职称口径（`?dyear=`）和导出页的职称表共用这一份。两处默认值各写一个的话，
 * 从成果页点到导出页，同一个「职称」看到的是两批东西
 */
export function promotionDeclareYearOptions(currentYear: number) {
  return [currentYear, currentYear + 1, currentYear + 2] as const;
}

export function defaultPromotionDeclareYear(currentYear: number): number {
  return currentYear + 1;
}

/** URL 上的 `dyear` → 申报年度。不在可选范围里的一律回落到默认值，不报错 */
export function parsePromotionDeclareYear(
  raw: string | null | undefined,
  currentYear: number,
): number {
  return (
    promotionDeclareYearOptions(currentYear).find((value) => String(value) === raw) ??
    defaultPromotionDeclareYear(currentYear)
  );
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

// ─── 封顶 ────────────────────────────────────────────────────────────

/**
 * 一个二级指标的封顶规则，取自当前在用的那版职称量化表（`PromotionCategory`）。
 *
 * 三层上限：本栏上限 `cap`；几栏共用一个上限时 `capGroup` 相同
 * （2.3+2.4 合并 3 分、4.1+4.2 合并 10 分、4.5+4.6 合并 9 分，独占时等于编号）；
 * 一级指标上限 `majorCap`。同组的 `cap` 一致、各组上限加起来等于一级上限，
 * 这两条导入时有常驻单测校验（lib/import/promotion-rules.ts）
 */
export type PromotionCapRule = {
  code: string;
  majorIndicator: string;
  minorIndicator: string;
  majorCap: number | null;
  cap: number | null;
  capGroup: string | null;
};

export type PromotionCapGroup = {
  /** 共用封顶组的名字，如「4.5+4.6」；独占时就是编号 */
  key: string;
  majorIndicator: string;
  /** 组里实际有分的那几栏 */
  codes: string[];
  raw: number;
  cap: number | null;
  counted: number;
};

export type PromotionCapMajor = {
  majorIndicator: string;
  /** 各组截完之后加起来的分 */
  raw: number;
  cap: number | null;
  counted: number;
};

export type PromotionCapResult = {
  /** 原始分相加，和表里逐条的分对得上 */
  rawTotal: number;
  /** 两层封顶都截完之后的合计 */
  cappedTotal: number;
  groups: PromotionCapGroup[];
  majors: PromotionCapMajor[];
  /** 被截掉的地方，界面逐条列出来：「4.5+4.6 合计 12 分，上限 9 分」 */
  overCap: Array<{ label: string; raw: number; cap: number }>;
};

/** 分值是 Decimal(6,2)，加几次就冒出 0.30000000000000004 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 按人事处量化表的封顶规则算合计：先按共用封顶组截，再按一级指标截。
 *
 * **这是计算不是判定**（CLAUDE.md 第 1 条）：每条成果的分照旧人工填、表里照旧逐条列原始分，
 * 这里只把「超过上限的那部分不计入」这条写在表上的算术做掉。此前合计是原始分直接相加，
 * 4.5 指导学生获奖和 4.6 毕设奖合起来填了 12 分，合计就比人事处认的多 3 分。
 *
 * - 规则按**编号**查当前那版表。查不到编号的（表换版后编号变了）不截、原样计入，
 *   宁可多算也不凭空砍分；这种情况 `groups` 里的 `cap` 是 null，看得出来
 * - 组内先把正负分相加再截：扣分冲抵的是这一栏的分，不是截完以后再扣
 * - 纯函数，入参是「编号 → 原始分」而不是成果行，成果页和导出各自先按编号加好再传进来
 */
export function applyPromotionCaps(
  entries: ReadonlyArray<{ code: string; majorIndicator: string; score: number }>,
  rules: ReadonlyArray<PromotionCapRule>,
): PromotionCapResult {
  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));

  const groups = new Map<string, PromotionCapGroup>();
  for (const entry of entries) {
    const rule = ruleByCode.get(entry.code);
    const key = rule ? (rule.capGroup ?? rule.code) : entry.code;
    const group = groups.get(key) ?? {
      key,
      majorIndicator: rule?.majorIndicator ?? entry.majorIndicator,
      codes: [],
      raw: 0,
      cap: rule?.cap ?? null,
      counted: 0,
    };
    if (!group.codes.includes(entry.code)) group.codes.push(entry.code);
    group.raw += entry.score;
    groups.set(key, group);
  }

  const majorCapOf = new Map<string, number>();
  for (const rule of rules) {
    if (rule.majorCap != null) majorCapOf.set(rule.majorIndicator, rule.majorCap);
  }

  const overCap: PromotionCapResult["overCap"] = [];
  const majors = new Map<string, PromotionCapMajor>();
  for (const group of groups.values()) {
    group.raw = round2(group.raw);
    group.counted = group.cap != null ? Math.min(group.raw, group.cap) : group.raw;
    if (group.cap != null && group.raw > group.cap) {
      overCap.push({ label: group.key, raw: group.raw, cap: group.cap });
    }
    const major = majors.get(group.majorIndicator) ?? {
      majorIndicator: group.majorIndicator,
      raw: 0,
      cap: majorCapOf.get(group.majorIndicator) ?? null,
      counted: 0,
    };
    major.raw += group.counted;
    majors.set(group.majorIndicator, major);
  }

  for (const major of majors.values()) {
    major.raw = round2(major.raw);
    major.counted = major.cap != null ? Math.min(major.raw, major.cap) : major.raw;
    if (major.cap != null && major.raw > major.cap) {
      overCap.push({ label: major.majorIndicator, raw: major.raw, cap: major.cap });
    }
  }

  return {
    rawTotal: round2(entries.reduce((sum, entry) => sum + entry.score, 0)),
    cappedTotal: round2([...majors.values()].reduce((sum, major) => sum + major.counted, 0)),
    groups: [...groups.values()],
    majors: [...majors.values()],
    overCap,
  };
}
