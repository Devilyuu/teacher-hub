import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import { checkboxField, dateOnlyField, optionalText } from "@/lib/schemas/project";

const achievementTypeEnum = z.enum([
  "PAPER",
  "REPORT",
  "TEXTBOOK",
  "CASE",
  "PATENT",
  "SOFTWARE_COPYRIGHT",
  "AWARD",
  "COURSE",
  "STUDENT_ACHIEVEMENT",
  "MEDIA_REPORT",
  "FUNDING_RECEIPT",
  "TRAINING",
  "SOCIAL_SERVICE",
  "OTHER",
]);

/**
 * 结题要求项表单。
 *
 * `rawText` 必填且是真相来源——不许只填结构化约束就把要求存了，
 * 立项文件的原话必须留着（CLAUDE.md 第 2 条）。
 */
export const requirementFormSchema = z.object({
  rawText: z.string().trim().min(1, "请把立项文件里这条要求的原文抄进来"),
  /** 多选，逗号分隔的枚举值；空 = 不限类型 */
  allowedTypes: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(achievementTypeEnum)),
  requiredCount: z
    .string()
    .trim()
    .transform((value) => (value === "" ? 1 : Number(value)))
    .refine((value) => Number.isInteger(value) && value >= 0, "数量应为非负整数"),
  dueDate: dateOnlyField,
  /**
   * constraints 用 JSON textarea 录入。V1 不做可视化表单构建器
   * （BUILD_PLAN 注意事项 3），但要挡住写坏的 JSON。
   */
  constraints: z
    .string()
    .trim()
    .transform((value) => (value === "" ? "{}" : value))
    .superRefine((value, ctx) => {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          ctx.addIssue({ code: "custom", message: "约束需要是一个 JSON 对象，如 {}" });
        }
      } catch {
        ctx.addIssue({ code: "custom", message: "JSON 格式有误，检查引号和逗号" });
      }
    })
    // 认不出的 key 不算错——parseConstraints 会宽松忽略，rawText 才是真相来源。
    // 这里只保证它是个合法 JSON 对象，能安全写进 Json 列。
    .transform((value) => JSON.parse(value) as Prisma.InputJsonObject),
});

export const linkFormSchema = z.object({
  requirementId: z.string().min(1),
  achievementId: z.string().min(1, "请选择要挂接的成果"),
});

export const qualifyFormSchema = z.object({
  linkId: z.string().min(1),
  isQualified: checkboxField,
  qualifyNote: optionalText,
});
