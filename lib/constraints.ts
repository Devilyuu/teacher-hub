/**
 * 挂接时的约束软校验（PRD 第 3 节末 / BUILD_PLAN Phase 1）。
 *
 * 三条铁律：
 * 1. **永远只是提示，永远不阻止保存**（CLAUDE.md 第 3 条）。本文件只产出文案，
 *    不返回"能不能挂"的布尔值，免得调用方拿它当拦截依据。
 * 2. **不影响达标判定**。是否达标只看人工勾选的 `isQualified`，
 *    校验全过也不会自动勾上，全不过也不会取消勾选。
 * 3. **信息缺失也提示**。用户的核心痛点就是"不知道还差什么"，
 *    "该成果未填字数"比默默放过更有用。
 */
import { ACHIEVEMENT_TYPE_LABELS, LEVEL_LABELS } from "@/lib/labels";
import { parseConstraints, type RequirementConstraints } from "@/lib/schemas/requirement";
import type { AchievementType, Level } from "@/lib/generated/prisma/enums";

export type ConstraintCheckInput = {
  requirement: {
    /** 空数组 = 不限类型 */
    allowedTypes: AchievementType[];
    /** Requirement.constraints 原始 Json */
    constraints: unknown;
  };
  achievement: {
    type: AchievementType;
    authorPosition?: number | null;
    wordCount?: number | null;
    indexedBy?: string | null;
    journalLevel?: Level | null;
  };
  /**
   * 最近一次检测值。CheckRecord 是 Phase 2 才有的表，
   * Phase 1 传 undefined，对应的约束就跳过不校验。
   */
  latestCheck?: {
    duplicationRate?: number | null;
    aigcRate?: number | null;
  };
};

export type ConstraintWarning = {
  /** 对应的 constraints key，或 `allowedTypes` */
  key: string;
  message: string;
};

export type ConstraintCheckResult = {
  /** 黄色警示，逐条显示在挂接卡片上 */
  warnings: ConstraintWarning[];
  /** 机器校验不了、需要人工核对的要求（checkPlatform 与 extra） */
  manualChecks: string[];
};

function checkType(
  allowedTypes: AchievementType[],
  actual: AchievementType,
): ConstraintWarning | null {
  // 空数组 = 不限类型，不提示（PRD 2.2）
  if (allowedTypes.length === 0 || allowedTypes.includes(actual)) return null;

  const expected = allowedTypes.map((t) => ACHIEVEMENT_TYPE_LABELS[t]).join("或");
  return {
    key: "allowedTypes",
    message: `要求类型为${expected}，该成果类型为${ACHIEVEMENT_TYPE_LABELS[actual]}`,
  };
}

function checkAuthorPosition(
  required: number,
  actual: number | null | undefined,
): ConstraintWarning | null {
  const label = required === 1 ? "第一作者" : `第 ${required} 作者及以前`;

  if (actual == null) {
    return { key: "authorPosition", message: `要求${label}，该成果未填作者位次` };
  }
  if (actual > required) {
    return { key: "authorPosition", message: `要求${label}，该成果作者位次为 ${actual}` };
  }
  return null;
}

function checkWordCount(
  constraints: RequirementConstraints,
  actual: number | null | undefined,
): ConstraintWarning[] {
  const { minWords, maxWords } = constraints;
  if (minWords == null && maxWords == null) return [];

  if (actual == null) {
    const requirement =
      minWords != null && maxWords != null
        ? `${minWords}–${maxWords} 字`
        : minWords != null
          ? `≥${minWords} 字`
          : `≤${maxWords} 字`;
    return [{ key: "wordCount", message: `要求${requirement}，该成果未填字数` }];
  }

  const warnings: ConstraintWarning[] = [];
  if (minWords != null && actual < minWords) {
    warnings.push({ key: "minWords", message: `要求 ≥${minWords} 字，当前 ${actual} 字` });
  }
  if (maxWords != null && actual > maxWords) {
    warnings.push({ key: "maxWords", message: `要求 ≤${maxWords} 字，当前 ${actual} 字` });
  }
  return warnings;
}

function checkIndexedBy(
  required: string,
  actual: string | null | undefined,
): ConstraintWarning | null {
  if (actual == null || actual.trim() === "") {
    return { key: "indexedBy", message: `要求 ${required} 收录，该成果未填收录情况` };
  }
  // 收录情况是自由文本（可能写成"CNKI、EI"），包含即视为满足
  if (actual.toUpperCase().includes(required.toUpperCase())) return null;

  return { key: "indexedBy", message: `要求 ${required} 收录，该成果收录情况为 ${actual}` };
}

function checkJournalLevel(
  required: string,
  actual: Level | null | undefined,
): ConstraintWarning | null {
  if (actual == null) {
    return { key: "journalLevel", message: `要求${required}期刊，该成果未填期刊级别` };
  }

  const actualLabel = LEVEL_LABELS[actual];
  // constraints 里存的是中文标签，直接比字面量。
  // 不做"省级 ≥ 市级"这类隐含排序——各单位口径不一，排错了比不排更糟。
  if (actualLabel === required) return null;

  return { key: "journalLevel", message: `要求${required}期刊，该成果期刊级别为${actualLabel}` };
}

function checkRate(
  key: "maxDupRate" | "maxAigcRate",
  label: string,
  limit: number,
  actual: number | null | undefined,
): ConstraintWarning | null {
  // 没有检测记录就不提示：还没送检是正常状态，不是问题
  if (actual == null) return null;
  if (actual <= limit) return null;

  return { key, message: `要求${label} ≤${limit}%，最近一次为 ${actual}%` };
}

export function checkConstraints(input: ConstraintCheckInput): ConstraintCheckResult {
  const constraints = parseConstraints(input.requirement.constraints);
  const { achievement, latestCheck } = input;

  const warnings: ConstraintWarning[] = [];

  const typeWarning = checkType(input.requirement.allowedTypes, achievement.type);
  if (typeWarning) warnings.push(typeWarning);

  if (constraints.authorPosition != null) {
    const w = checkAuthorPosition(constraints.authorPosition, achievement.authorPosition);
    if (w) warnings.push(w);
  }

  warnings.push(...checkWordCount(constraints, achievement.wordCount));

  if (constraints.indexedBy != null) {
    const w = checkIndexedBy(constraints.indexedBy, achievement.indexedBy);
    if (w) warnings.push(w);
  }

  if (constraints.journalLevel != null) {
    const w = checkJournalLevel(constraints.journalLevel, achievement.journalLevel);
    if (w) warnings.push(w);
  }

  if (constraints.maxDupRate != null) {
    const w = checkRate("maxDupRate", "查重率", constraints.maxDupRate, latestCheck?.duplicationRate);
    if (w) warnings.push(w);
  }

  if (constraints.maxAigcRate != null) {
    const w = checkRate("maxAigcRate", "AIGC 率", constraints.maxAigcRate, latestCheck?.aigcRate);
    if (w) warnings.push(w);
  }

  const manualChecks: string[] = [];
  if (constraints.checkPlatform) {
    manualChecks.push(`须以「${constraints.checkPlatform}」的检测结果为准`);
  }
  manualChecks.push(...(constraints.extra ?? []));

  return { warnings, manualChecks };
}
