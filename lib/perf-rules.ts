/**
 * 绩效赋分规则的显示口径。
 *
 * 六列是学校 Excel 的原文照抄：源表里是「10/次」「0.5/万元（上限10分）」
 * 「10/项（市级）、5/项（市辖区级）」「——」这类写法，没有统一语法。
 * **一律不解析，只显示给人看，分由人填**（CLAUDE.md 第 1 条：只计算不判定）。
 *
 * 也**不写「成果级别 → 规则列」的映射**。看着理所当然（省级成果就看省级列），
 * 但那正是第 11 条禁止的那类映射：学校哪年把两列合并或拆细，函数就开始骗人。
 * 做法是把有值的列全摆出来，标上级别名，由人自己看哪条适用。
 */

export type PerfRuleColumns = {
  baseRule: string | null;
  nationalRule: string | null;
  provincialRule: string | null;
  cityRule: string | null;
  schoolRule: string | null;
  collegeRule: string | null;
};

/** 列名到界面标签。顺序就是申报表上的顺序，不按条数或字母重排 */
const RULE_LABELS: Array<[keyof PerfRuleColumns, string]> = [
  ["baseRule", "基本分"],
  ["nationalRule", "国家级"],
  ["provincialRule", "省级"],
  ["cityRule", "市级"],
  ["schoolRule", "校级"],
  ["collegeRule", "学院级"],
];

/**
 * 把有值的规则列拼成一行，如「基本分 8/门　省级 10/项」。
 *
 * 全部为空返回空串——源表里确实有整行「——」的条目，
 * 那时候不该显示一个孤零零的标签。
 */
export function formatPerfRules(rules: PerfRuleColumns): string {
  return RULE_LABELS.map(([key, label]) => {
    const value = rules[key]?.trim();
    return value ? `${label} ${value}` : null;
  })
    .filter(Boolean)
    .join("　");
}
