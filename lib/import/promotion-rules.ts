/**
 * 解析人事处《业绩量化考核表》（附件1 分类表 + 附件2 赋分细则）。
 *
 * 纯函数，不碰数据库——写库在 `scripts/import-promotion-rules.ts`。
 *
 * **不解析分值。** 和 PerfCategory 同一个理由：「国家级每项加6分」
 * 「到账经费每10万元0.8分，上限8分」「主编4分，副主编2分」没有统一语法，
 * 硬解析必然出错。规则原样存下来给人看，分数人工填。
 *
 * 但**封顶分要校验**：附件2 的备注散在表格各处，PDF 抽出来顺序是乱的，
 * 「哪条备注属于哪个指标」是人读出来的。好在这套数据自带两重校验——
 * 各栏封顶分按一级指标相加应等于一级封顶，
 * 再扣掉不适用的指标应等于表头写的四个系列总分。
 * 两重都对上，配对才算可信。这两项校验就在本文件里。
 */
import { z } from "zod";

const titleSeriesEnum = z.enum(["TEACHER", "LAB", "IDEOLOGY", "EDU_ADMIN"]);

export type TitleSeriesValue = z.infer<typeof titleSeriesEnum>;

const indicatorSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d+\.\d+$/, "二级指标编号应形如 5.2"),
  major_indicator: z.string().trim().min(1),
  major_cap: z.number(),
  minor_indicator: z.string().trim().min(1),
  scoring_rule: z.string().trim().min(1),
  remark: z.string().nullish(),
  cap: z.number().nullish(),
  cap_group: z.string().trim().min(1),
  cap_note: z.string().nullish(),
  applies_to: z.array(titleSeriesEnum).min(1),
});

export const promotionRulesetSchema = z.object({
  year: z.number().int(),
  source: z.string().min(1),
  sourceNote: z.string().nullish(),
  seriesTotals: z.object({
    teacher: z.number(),
    lab: z.number(),
    ideology: z.number(),
    eduAdmin: z.number(),
  }),
  generalNotes: z.array(z.string().min(1)).min(1),
  indicators: z.array(indicatorSchema).min(1),
});

export type PromotionRulesetInput = z.infer<typeof promotionRulesetSchema>;

export type PromotionCategoryDraft = {
  year: number;
  code: string;
  majorIndicator: string;
  majorCap: number;
  minorIndicator: string;
  scoringRule: string;
  remark: string | null;
  cap: number | null;
  capGroup: string;
  capNote: string | null;
  appliesTo: TitleSeriesValue[];
  sortOrder: number;
};

export type RulesetHeadDraft = {
  year: number;
  source: string;
  generalNotes: string[];
  teacherTotal: number;
  labTotal: number;
  ideologyTotal: number;
  eduAdminTotal: number;
};

export type PromotionPlan = {
  head: RulesetHeadDraft;
  drafts: PromotionCategoryDraft[];
  warnings: string[];
  /** 封顶分校验的逐项结果，导入脚本原样打印 */
  checks: CapCheck[];
};

export type CapCheck = {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
};

/** 「5.2」→ [5, 2]，用于排序。4.10 必须排在 4.9 之后，字符串排序会把它排到 4.1 后面 */
export function parseCode(code: string): [number, number] {
  const [major, minor] = code.split(".");
  return [Number(major), Number(minor)];
}

export function compareCode(a: string, b: string): number {
  const [am, an] = parseCode(a);
  const [bm, bn] = parseCode(b);
  return am - bm || an - bn;
}

/**
 * 共用封顶的分组只算一次。
 * 2.3+2.4 合并上限 3 分，两行各写 cap=3，相加会得 6。
 */
export function sumCapsByGroup(
  rows: Array<{ capGroup: string; cap: number | null }>,
): number {
  const perGroup = new Map<string, number>();
  for (const row of rows) {
    if (row.cap == null) continue;
    // 同组的 cap 必须一致，不一致在 buildPromotionPlan 里已告警，这里取最大值兜底
    perGroup.set(row.capGroup, Math.max(perGroup.get(row.capGroup) ?? 0, row.cap));
  }
  let total = 0;
  for (const value of perGroup.values()) total += value;
  return total;
}

const SERIES_LABELS: Record<TitleSeriesValue, string> = {
  TEACHER: "教师系列",
  LAB: "实验系列",
  IDEOLOGY: "思政系列",
  EDU_ADMIN: "教管系列",
};

/**
 * 建导入计划，顺带跑两重封顶校验。
 *
 * 校验**只告警不阻断**——和全站的约束校验一个规矩（CLAUDE.md 第 3 条）。
 * 人事处哪天改表改出个对不上的数，脚本该照样能把新表导进去，
 * 而不是把人卡在门外。
 */
export function buildPromotionPlan(input: unknown): PromotionPlan {
  const doc = promotionRulesetSchema.parse(input);
  const warnings: string[] = [];

  const seen = new Map<string, number>();
  const drafts: PromotionCategoryDraft[] = [];

  const sorted = [...doc.indicators].sort((a, b) => compareCode(a.code, b.code));

  sorted.forEach((row, index) => {
    const firstAt = seen.get(row.code);
    if (firstAt != null) {
      warnings.push(`指标编号 ${row.code} 重复（第 ${firstAt + 1} 条与第 ${index + 1} 条），已跳过后一条`);
      return;
    }
    seen.set(row.code, index);

    drafts.push({
      year: doc.year,
      code: row.code,
      majorIndicator: row.major_indicator,
      majorCap: row.major_cap,
      minorIndicator: row.minor_indicator,
      scoringRule: row.scoring_rule,
      remark: row.remark?.trim() || null,
      cap: row.cap ?? null,
      capGroup: row.cap_group,
      capNote: row.cap_note?.trim() || null,
      appliesTo: row.applies_to,
      sortOrder: index,
    });
  });

  // 同一 capGroup 的 cap 必须一致，否则是抄表时串行了
  const groupCaps = new Map<string, Set<number>>();
  for (const draft of drafts) {
    if (draft.cap == null) continue;
    const set = groupCaps.get(draft.capGroup) ?? new Set<number>();
    set.add(draft.cap);
    groupCaps.set(draft.capGroup, set);
  }
  for (const [group, caps] of groupCaps) {
    if (caps.size > 1) {
      warnings.push(`共用封顶组「${group}」里出现了不同的上限：${[...caps].join(" / ")}`);
    }
  }

  // 一级指标封顶必须在组内一致
  const majorCaps = new Map<string, Set<number>>();
  for (const draft of drafts) {
    const set = majorCaps.get(draft.majorIndicator) ?? new Set<number>();
    set.add(draft.majorCap);
    majorCaps.set(draft.majorIndicator, set);
  }
  for (const [major, caps] of majorCaps) {
    if (caps.size > 1) {
      warnings.push(`一级指标「${major}」的封顶分不一致：${[...caps].join(" / ")}`);
    }
  }

  const checks: CapCheck[] = [];

  // 校验一：各栏封顶（按共用组去重）相加 == 一级指标封顶
  for (const [major, caps] of majorCaps) {
    const rows = drafts.filter((d) => d.majorIndicator === major);
    const actual = sumCapsByGroup(rows);
    const expected = [...caps][0];
    checks.push({ label: `一级指标「${major}」`, expected, actual, ok: nearlyEqual(expected, actual) });
  }

  // 校验二：某系列可用的栏目封顶相加 == 附件1 给的该系列总分
  const totals: Array<[TitleSeriesValue, number]> = [
    ["TEACHER", doc.seriesTotals.teacher],
    ["LAB", doc.seriesTotals.lab],
    ["IDEOLOGY", doc.seriesTotals.ideology],
    ["EDU_ADMIN", doc.seriesTotals.eduAdmin],
  ];
  for (const [series, expected] of totals) {
    const rows = drafts.filter((d) => d.appliesTo.includes(series));
    const actual = sumCapsByGroup(rows);
    checks.push({
      label: `${SERIES_LABELS[series]}总分`,
      expected,
      actual,
      ok: nearlyEqual(expected, actual),
    });
  }

  for (const check of checks) {
    if (!check.ok) {
      warnings.push(`${check.label}对不上：附件写 ${check.expected}，各栏封顶相加得 ${check.actual}`);
    }
  }

  return {
    head: {
      year: doc.year,
      source: doc.source,
      generalNotes: doc.generalNotes,
      teacherTotal: doc.seriesTotals.teacher,
      labTotal: doc.seriesTotals.lab,
      ideologyTotal: doc.seriesTotals.ideology,
      eduAdminTotal: doc.seriesTotals.eduAdmin,
    },
    drafts,
    warnings,
    checks,
  };
}

/** 分值都是一两位小数，浮点相加会掉精度 */
function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** 一级指标出现顺序，导入脚本打印分组用 */
export function majorIndicatorsInOrder(drafts: PromotionCategoryDraft[]): string[] {
  const seen: string[] = [];
  for (const draft of drafts) {
    if (!seen.includes(draft.majorIndicator)) seen.push(draft.majorIndicator);
  }
  return seen;
}

export { SERIES_LABELS };
