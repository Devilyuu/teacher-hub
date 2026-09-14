import { z } from "zod";

/**
 * Requirement.constraints 的形状（PRD 2.2）。
 *
 * 全部字段可选，且解析永远不能抛错——constraints 是 Json 列，历史数据、
 * AI 抽取结果、手工编辑都可能塞进意料之外的东西。解析不出来就当没有这条约束，
 * `rawText` 才是真相来源（CLAUDE.md 第 2 条）。
 */
export const requirementConstraintsSchema = z.object({
  /** 收录要求，如 CNKI / EI / SCI */
  indexedBy: z.string().min(1).optional(),
  /** 期刊级别，存中文标签，如"省级" */
  journalLevel: z.string().min(1).optional(),
  /** 作者位次要求：1 表示须为第一作者 */
  authorPosition: z.number().int().positive().optional(),
  minWords: z.number().int().nonnegative().optional(),
  maxWords: z.number().int().nonnegative().optional(),
  /** 查重率上限，百分比 */
  maxDupRate: z.number().nonnegative().optional(),
  /** AIGC 检测上限，百分比 */
  maxAigcRate: z.number().nonnegative().optional(),
  /** 立项文件指定的查重平台，不同平台结果差异大，只展示不校验 */
  checkPlatform: z.string().min(1).optional(),
  /** 兜底：无法结构化的要求，只展示不校验 */
  extra: z.array(z.string().min(1)).optional(),
});

export type RequirementConstraints = z.infer<typeof requirementConstraintsSchema>;

/**
 * 宽松解析：认识的 key 留下，不认识或类型不对的丢掉，绝不抛错。
 */
export function parseConstraints(raw: unknown): RequirementConstraints {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = requirementConstraintsSchema.shape[key as keyof RequirementConstraints];
    if (field && field.safeParse(value).success) {
      result[key] = value;
    }
  }
  return result as RequirementConstraints;
}
