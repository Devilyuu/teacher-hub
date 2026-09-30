/**
 * 导入预览：这次要写的每一行跟库里比，是新增、要改、还是一样。
 *
 * 纯函数。库里的行由调用方先查好传进来（lib/actions/rule-actions.ts）。
 * 界面拿它画预览表，确认前人能看清「会动哪几行」——尤其是重导同一年度的表时，
 * 改了的那几行要一眼看得出来。
 */
import { formatPerfRules } from "@/lib/perf-rules";
import type { PerfCategoryDraft } from "@/lib/import/perf-rules";
import type { PromotionCategoryDraft } from "@/lib/import/promotion-rules";

export type RowChange = "new" | "changed" | "same";

export type PreviewRow = {
  key: string;
  /** 一级指标 / 大类 */
  group: string;
  /** 「5.2 纵向课题」或小类名 */
  label: string;
  /** 上限、规则原文这类，预览表第三列 */
  detail: string;
  change: RowChange;
  /** 改了哪几项，只在 change === "changed" 时有 */
  changedFields: string[];
};

export type UntouchedRow = { label: string; linkedCount: number };

export type PreviewDiff = {
  rows: PreviewRow[];
  counts: Record<RowChange, number>;
  /** 库里有、这次没有的行：导入不删它们，原样保留 */
  untouched: UntouchedRow[];
};

export type ExistingPromotionRow = {
  code: string;
  majorIndicator: string;
  majorCap: number | null;
  minorIndicator: string;
  scoringRule: string | null;
  remark: string | null;
  cap: number | null;
  capGroup: string | null;
  capNote: string | null;
  appliesTo: string[];
  projectEligible: boolean;
  linkedCount: number;
};

export type ExistingPerfRow = {
  majorCategory: string;
  minorCategory: string;
  baseRule: string | null;
  nationalRule: string | null;
  provincialRule: string | null;
  cityRule: string | null;
  schoolRule: string | null;
  collegeRule: string | null;
  remark: string | null;
  isTeam: boolean;
  isDepartmentAssigned: boolean;
  isActive: boolean;
  projectEligible: boolean;
  linkedCount: number;
};

function countBy(rows: PreviewRow[]): Record<RowChange, number> {
  return {
    new: rows.filter((row) => row.change === "new").length,
    changed: rows.filter((row) => row.change === "changed").length,
    same: rows.filter((row) => row.change === "same").length,
  };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\u0001") === [...b].sort().join("\u0001");

export function promotionCapText(draft: Pick<PromotionCategoryDraft, "cap" | "capGroup" | "code">): string {
  if (draft.cap == null) return "";
  return draft.capGroup !== draft.code ? `上限 ${draft.cap}（与 ${draft.capGroup} 共用）` : `上限 ${draft.cap}`;
}

export function diffPromotion(
  existingRows: ExistingPromotionRow[],
  drafts: PromotionCategoryDraft[],
): PreviewDiff {
  const byCode = new Map(existingRows.map((row) => [row.code, row]));
  const rows = drafts.map((draft): PreviewRow => {
    const before = byCode.get(draft.code);
    const detail = [promotionCapText(draft), draft.scoringRule ?? ""].filter(Boolean).join("　");
    const base = {
      key: draft.code,
      group: draft.majorIndicator,
      label: `${draft.code} ${draft.minorIndicator}`,
      detail,
    };
    if (!before) return { ...base, change: "new", changedFields: [] };

    const changed: string[] = [];
    if (before.majorIndicator !== draft.majorIndicator) changed.push("一级指标");
    if (before.majorCap !== draft.majorCap) changed.push("一级上限");
    if (before.minorIndicator !== draft.minorIndicator) changed.push("二级指标名");
    if ((before.scoringRule ?? null) !== draft.scoringRule) changed.push("赋分原文");
    if ((before.remark ?? null) !== draft.remark) changed.push("备注");
    if (before.cap !== draft.cap) changed.push("本栏上限");
    if ((before.capGroup ?? before.code) !== draft.capGroup) changed.push("共用上限");
    if ((before.capNote ?? null) !== draft.capNote) changed.push("上限说明");
    if (!sameList(before.appliesTo, draft.appliesTo)) changed.push("适用系列");
    if (draft.projectEligible !== undefined && before.projectEligible !== draft.projectEligible) {
      changed.push("课题可挂");
    }
    return { ...base, change: changed.length > 0 ? "changed" : "same", changedFields: changed };
  });

  const incoming = new Set(drafts.map((draft) => draft.code));
  const untouched = existingRows
    .filter((row) => !incoming.has(row.code))
    .map((row) => ({ label: `${row.code} ${row.minorIndicator}`, linkedCount: row.linkedCount }));

  return { rows, counts: countBy(rows), untouched };
}

const PERF_FIELDS: Array<[keyof ExistingPerfRow & keyof PerfCategoryDraft, string]> = [
  ["baseRule", "基本分"],
  ["nationalRule", "国家级"],
  ["provincialRule", "省级"],
  ["cityRule", "市级"],
  ["schoolRule", "校级"],
  ["collegeRule", "学院级"],
  ["remark", "备注"],
];

const PERF_FLAGS: Array<[keyof ExistingPerfRow & keyof PerfCategoryDraft, string]> = [
  ["isTeam", "团队项目"],
  ["isDepartmentAssigned", "学院分配名额"],
  ["isActive", "启用"],
  ["projectEligible", "课题可挂"],
];

const perfKey = (major: string, minor: string) => JSON.stringify([major, minor]);

export function diffPerf(existingRows: ExistingPerfRow[], drafts: PerfCategoryDraft[]): PreviewDiff {
  const byKey = new Map(existingRows.map((row) => [perfKey(row.majorCategory, row.minorCategory), row]));
  const rows = drafts.map((draft): PreviewRow => {
    const key = perfKey(draft.majorCategory, draft.minorCategory);
    const before = byKey.get(key);
    const base = {
      key,
      group: draft.majorCategory,
      label: draft.minorCategory,
      detail: formatPerfRules(draft),
    };
    if (!before) return { ...base, change: "new", changedFields: [] };

    const changed = PERF_FIELDS.filter(([field]) => (before[field] ?? null) !== (draft[field] ?? null)).map(
      ([, label]) => label,
    );
    for (const [field, label] of PERF_FLAGS) {
      if (draft[field] !== undefined && before[field] !== draft[field]) changed.push(label);
    }
    return { ...base, change: changed.length > 0 ? "changed" : "same", changedFields: changed };
  });

  const incoming = new Set(drafts.map((draft) => perfKey(draft.majorCategory, draft.minorCategory)));
  const untouched = existingRows
    .filter((row) => !incoming.has(perfKey(row.majorCategory, row.minorCategory)))
    .map((row) => ({ label: `${row.majorCategory} / ${row.minorCategory}`, linkedCount: row.linkedCount }));

  return { rows, counts: countBy(rows), untouched };
}
