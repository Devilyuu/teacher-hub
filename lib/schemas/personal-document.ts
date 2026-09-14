import { z } from "zod";
import { optionalText } from "@/lib/schemas/project";

/** 个人常用文档上传表单；分类是外键，不接受自由文本。 */
export const personalDocumentUploadSchema = z.object({
  categoryId: z.string().trim().min(1, "请选择文档分类"),
  note: optionalText,
});

/** 分类可现场新建，但要限制极端长的字典值。 */
export const docCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, "请填写分类名称").max(50, "分类名称最多 50 个字符"),
});
