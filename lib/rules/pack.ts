/**
 * 规则包：把库里某一年度的职称表 / 绩效表写成一份 JSON，给同校的同事直接导入。
 *
 * **格式就是导入格式**（examples/*.example.json 那两份），不另起一套：
 * 导出的文件原样喂回 buildPromotionPlan / buildCatalogPlan 就能导进去，
 * 单测锁着这个往返。一所学校只需一个人整理一次。
 *
 * 纯函数，行由调用方查好传进来（app/api/rules/export/route.ts）。
 */
import { PERF_PACK_FORMAT } from "@/lib/import/perf-rules";
import { PROMOTION_PACK_FORMAT, type TitleSeriesValue } from "@/lib/import/promotion-rules";

export type PromotionPackSource = {
  ruleset: {
    year: number;
    source: string;
    generalNotes: string[];
    teacherTotal: number | null;
    labTotal: number | null;
    ideologyTotal: number | null;
    eduAdminTotal: number | null;
  };
  categories: Array<{
    code: string;
    majorIndicator: string;
    majorCap: number | null;
    minorIndicator: string;
    scoringRule: string | null;
    remark: string | null;
    cap: number | null;
    capGroup: string | null;
    capNote: string | null;
    appliesTo: TitleSeriesValue[];
    projectEligible: boolean;
    sortOrder: number;
  }>;
};

/** 空值不写进文件：一份给人看、也给人改的 JSON，满屏 null 只会让人不敢动 */
function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value != null)) as Partial<T>;
}

export function promotionPackOf({ ruleset, categories }: PromotionPackSource) {
  const totals = [ruleset.teacherTotal, ruleset.labTotal, ruleset.ideologyTotal, ruleset.eduAdminTotal];
  return {
    format: PROMOTION_PACK_FORMAT,
    year: ruleset.year,
    source: ruleset.source,
    sourceNote: "由教师个人中台导出。在「设置 → 职称表与绩效表 → 导入规则包」里选这个文件即可导入",
    ...(totals.every((value) => value != null)
      ? {
          seriesTotals: {
            teacher: ruleset.teacherTotal!,
            lab: ruleset.labTotal!,
            ideology: ruleset.ideologyTotal!,
            eduAdmin: ruleset.eduAdminTotal!,
          },
        }
      : {}),
    generalNotes: ruleset.generalNotes,
    indicators: [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) =>
        compact({
          code: category.code,
          major_indicator: category.majorIndicator,
          major_cap: category.majorCap,
          minor_indicator: category.minorIndicator,
          scoring_rule: category.scoringRule,
          remark: category.remark,
          cap: category.cap,
          // 独占上限时组名就是编号，不写——省得改编号时还要记得改它
          cap_group: category.capGroup && category.capGroup !== category.code ? category.capGroup : null,
          cap_note: category.capNote,
          applies_to: category.appliesTo.length > 0 ? category.appliesTo : null,
          project_eligible: category.projectEligible,
        }),
      ),
  };
}

export type PerfPackSource = {
  year: number;
  categories: Array<{
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
    sortOrder: number;
  }>;
};

export function perfPackOf({ year, categories }: PerfPackSource) {
  return {
    format: PERF_PACK_FORMAT,
    year,
    source: `绩效对照表 ${year} 版（由教师个人中台导出）`,
    rules: [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) =>
        compact({
          category: category.majorCategory,
          subcategory: category.minorCategory,
          base_rule: category.baseRule,
          national_rule: category.nationalRule,
          provincial_rule: category.provincialRule,
          city_rule: category.cityRule,
          school_rule: category.schoolRule,
          college_rule: category.collegeRule,
          remark: category.remark,
          is_team: category.isTeam,
          is_department_assigned: category.isDepartmentAssigned,
          is_active: category.isActive,
          project_eligible: category.projectEligible,
          sort_order: category.sortOrder,
        }),
      ),
  };
}

/** 规则包文件名。只进 Content-Disposition，不进 URL（附件文件名不进 URL 的同一条规矩） */
export function rulePackFileName(table: "promotion" | "perf", year: number): string {
  return table === "promotion" ? `职称量化表-${year}.json` : `绩效对照表-${year}.json`;
}

export type DetectedPack =
  | { table: "promotion"; doc: unknown }
  | { table: "perf"; doc: unknown }
  | { table: null; reason: string };

/** 认出一份 JSON 是哪张表的规则包：先认格式标记，没有标记按键名认（手写的、老版本导出的都没标记） */
export function detectRulePack(value: unknown): DetectedPack {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return { table: null, reason: "这不是规则包：文件里应当是一个 JSON 对象" };
  }
  const record = value as Record<string, unknown>;
  if (record.format === PROMOTION_PACK_FORMAT || Array.isArray(record.indicators)) {
    return { table: "promotion", doc: value };
  }
  if (record.format === PERF_PACK_FORMAT || Array.isArray(record.rules)) {
    return { table: "perf", doc: value };
  }
  return { table: null, reason: "认不出是哪张表：职称表的规则包里应有 indicators，绩效表的应有 rules" };
}
