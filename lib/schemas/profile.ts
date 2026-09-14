import { z } from "zod";
import { dateOnlyField, optionalText } from "@/lib/schemas/project";

/**
 * 我的档案（prd-support）。全库只有一条，导出模板里的
 * `{{本人姓名}}`、`{{承担单位}}` 由它填。
 *
 * `currentTitleSince` 不是装饰字段：职称量化只算「任现职以来」到申报年度
 * 上一年 12 月 31 日的成果（附件2 说明第 2 条），成果库的职称口径按它过滤。
 * **纯日期列**，走 dateOnlyField 转成 UTC 午夜，否则东八区会差一天。
 */
export const profileFormSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名"),
  unit: z.string().trim().min(1, "请填写承担单位"),
  department: optionalText,
  title: optionalText,
  currentTitle: optionalText,
  currentTitleSince: dateOnlyField,
  phone: optionalText,
  // 邮箱只做最宽松的校验：没有 @ 或带空格才拦。填了怪值也不该挡住整张表保存
  email: optionalText.refine(
    (value) => value == null || (/^[^\s@]+@[^\s@]+$/.test(value)),
    "邮箱格式不太对",
  ),
  obsidianVaultPath: optionalText,
});

export type ProfileFormInput = z.output<typeof profileFormSchema>;
