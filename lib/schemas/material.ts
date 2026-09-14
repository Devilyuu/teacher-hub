import { z } from "zod";
import { checkboxField, optionalText } from "@/lib/schemas/project";

/**
 * 要求项 ↔ 课题材料的关联表单（规格 6.4）。
 *
 * 这里只校验形状。「材料和要求项是不是同一个课题」这类跨行校验查库才知道，
 * 放在 lib/materials.ts 的 checkMaterialLinkable。
 */
export const materialLinkFormSchema = z.object({
  requirementId: z.string().min(1),
  attachmentId: z.string().min(1, "请选择要关联的材料"),
  note: optionalText,
});

export const materialQualificationFormSchema = z.object({
  linkId: z.string().min(1),
  isQualified: checkboxField,
  qualifyNote: optionalText,
});

export const requirementReportUploadFormSchema = z.object({
  note: optionalText,
  legacyAchievementId: z.string().min(1).optional(),
});
