/**
 * 解析职称量化表（本校叫人事处《业绩量化考核表》：附件1 分类表 + 附件2 赋分细则）。
 *
 * 纯函数，不碰数据库——写库在 `lib/rules/apply.ts`（命令行脚本和设置页的导入共用）。
 *
 * 输入就是「规则包」JSON：`examples/promotion-rules.example.json` 是格式样板，
 * 设置页「导出规则包」吐出来的也是这个格式，粘贴导入也是先把表格转成它再走这里
 * （lib/import/pasted-table.ts）。三条路一个出口。
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
 *
 * **别的学校的表多半没有这么全**（2026-09-27 放宽）：编号格式不限，一级上限、本栏上限、
 * 赋分原文、适用系列、系列总分、整表说明全都可以缺。缺了的那一重校验就不跑——
 * 拿不全的数去比只会报一串假告警。
 */
import { z } from "zod";
import { compareIndicatorCode } from "@/lib/promotion";

/** 规则包里的格式标记。导出时写上，导入时认它（没有也行，按键名认） */
export const PROMOTION_PACK_FORMAT = "teacher-desk/promotion-rules@1";

const titleSeriesEnum = z.enum(["TEACHER", "LAB", "IDEOLOGY", "EDU_ADMIN"]);

export type TitleSeriesValue = z.infer<typeof titleSeriesEnum>;

/** 分值、上限：非负、最多两位小数的那种数。库里是 Decimal(6,2) */
const capNumber = z.number().nonnegative("上限不能是负数").max(9999, "上限太大了");

const indicatorSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "指标编号不能为空")
    .max(20, "指标编号最多 20 个字"),
  major_indicator: z.string().trim().min(1, "一级指标名不能为空"),
  major_cap: capNumber.nullish(),
  minor_indicator: z.string().trim().min(1, "二级指标名不能为空"),
  scoring_rule: z.string().nullish(),
  remark: z.string().nullish(),
  cap: capNumber.nullish(),
  cap_group: z.string().trim().nullish(),
  cap_note: z.string().nullish(),
  applies_to: z.array(titleSeriesEnum).nullish(),
  /** 课题能不能挂这一项。没写 = 保留库里原来的勾（新建时不勾） */
  project_eligible: z.boolean().nullish(),
});

export const promotionRulesetSchema = z.object({
  format: z.string().nullish(),
  year: z.number().int().min(2000, "年度不对").max(2100, "年度不对"),
  source: z.string().trim().min(1, "要写这张表的出处"),
  sourceNote: z.string().nullish(),
  seriesTotals: z
    .object({
      teacher: z.number(),
      lab: z.number(),
      ideology: z.number(),
      eduAdmin: z.number(),
    })
    .nullish(),
  generalNotes: z.array(z.string().trim().min(1)).nullish(),
  indicators: z.array(indicatorSchema).min(1, "一条指标都没有"),
});

export type PromotionRulesetInput = z.infer<typeof promotionRulesetSchema>;

export type PromotionCategoryDraft = {
  year: number;
  code: string;
  majorIndicator: string;
  majorCap: number | null;
  minorIndicator: string;
  scoringRule: string | null;
  remark: string | null;
  cap: number | null;
  capGroup: string;
  capNote: string | null;
  appliesTo: TitleSeriesValue[];
  /** undefined = 文件里没写，写库时保留库里原来的勾 */
  projectEligible: boolean | undefined;
  sortOrder: number;
};

export type RulesetHeadDraft = {
  year: number;
  source: string;
  generalNotes: string[];
  teacherTotal: number | null;
  labTotal: number | null;
  ideologyTotal: number | null;
  eduAdminTotal: number | null;
};

export type PromotionPlan = {
  head: RulesetHeadDraft;
  drafts: PromotionCategoryDraft[];
  warnings: string[];
  /** 封顶分校验的逐项结果，导入预览和命令行脚本原样列出来 */
  checks: CapCheck[];
};

export type CapCheck = {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
};

/** 指标编号的自然序（4.10 在 4.9 后），和界面、导出用的是同一个比较函数 */
export const compareCode = compareIndicatorCode;

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

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * 建导入计划，顺带跑两重封顶校验。
 *
 * 校验**只告警不阻断**——和全站的约束校验一个规矩（CLAUDE.md 第 3 条）。
 * 人事处哪天改表改出个对不上的数，也该照样能把新表导进去，
 * 而不是把人卡在门外。
 */
export function buildPromotionPlan(input: unknown): PromotionPlan {
  const doc = promotionRulesetSchema.parse(input);
  const warnings: string[] = [];

  // 一级上限只写在某一行上也认（粘贴来的表常常只在合并单元格的第一行有值）：
  // 同一个一级指标下取唯一的那个非空值；写了两个不同的数就不替人挑，逐行照原样、再告警
  const majorCapValues = new Map<string, Set<number>>();
  for (const row of doc.indicators) {
    if (row.major_cap == null) continue;
    const set = majorCapValues.get(row.major_indicator) ?? new Set<number>();
    set.add(row.major_cap);
    majorCapValues.set(row.major_indicator, set);
  }
  for (const [major, caps] of majorCapValues) {
    if (caps.size > 1) {
      warnings.push(`一级指标「${major}」的封顶分不一致：${[...caps].join(" / ")}`);
    }
  }
  const majorCapOf = (major: string, own: number | null | undefined): number | null => {
    if (own != null) return own;
    const caps = majorCapValues.get(major);
    return caps?.size === 1 ? [...caps][0]! : null;
  };

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
      majorCap: majorCapOf(row.major_indicator, row.major_cap),
      minorIndicator: row.minor_indicator,
      scoringRule: blankToNull(row.scoring_rule),
      remark: blankToNull(row.remark),
      cap: row.cap ?? null,
      capGroup: blankToNull(row.cap_group) ?? row.code,
      capNote: blankToNull(row.cap_note),
      appliesTo: row.applies_to ?? [],
      projectEligible: row.project_eligible ?? undefined,
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

  const checks: CapCheck[] = [];

  // 校验一：各栏封顶（按共用组去重）相加 == 一级指标封顶。
  // 只在这个一级指标写了上限、而且底下每一栏都有上限时才比——缺一栏，加出来的数就没法比
  for (const [major, caps] of majorCapValues) {
    if (caps.size !== 1) continue;
    const rows = drafts.filter((d) => d.majorIndicator === major);
    if (rows.some((row) => row.cap == null)) continue;
    const expected = [...caps][0]!;
    const actual = sumCapsByGroup(rows);
    checks.push({ label: `一级指标「${major}」`, expected, actual, ok: nearlyEqual(expected, actual) });
  }

  // 校验二：某系列可用的栏目封顶相加 == 附件1 给的该系列总分。
  // 只有表头给了系列总分、各栏也标了适用系列时才比（本校的表才有这一层）
  if (doc.seriesTotals && drafts.some((d) => d.appliesTo.length > 0)) {
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
  }

  for (const check of checks) {
    if (!check.ok) {
      warnings.push(`${check.label}对不上：表上写 ${check.expected}，各栏封顶相加得 ${check.actual}`);
    }
  }

  return {
    head: {
      year: doc.year,
      source: doc.source,
      generalNotes: doc.generalNotes ?? [],
      teacherTotal: doc.seriesTotals?.teacher ?? null,
      labTotal: doc.seriesTotals?.lab ?? null,
      ideologyTotal: doc.seriesTotals?.ideology ?? null,
      eduAdminTotal: doc.seriesTotals?.eduAdmin ?? null,
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

/** 一级指标出现顺序，导入预览和命令行脚本分组用 */
export function majorIndicatorsInOrder(drafts: PromotionCategoryDraft[]): string[] {
  const seen: string[] = [];
  for (const draft of drafts) {
    if (!seen.includes(draft.majorIndicator)) seen.push(draft.majorIndicator);
  }
  return seen;
}

export { SERIES_LABELS };
