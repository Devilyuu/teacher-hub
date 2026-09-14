import { z } from "zod";
import { dateOnlyField } from "@/lib/schemas/project";

/**
 * 学期表单。名字格式不强校验成 XXXX-XXXX-N——那是习惯写法不是规范，
 * 强校验会把「2026 暑期」这类真实存在的叫法挡在门外。
 */
export const semesterFormSchema = z.object({
  name: z.string().trim().min(1, "学期名不能为空").max(32, "学期名太长了"),
  startDate: dateOnlyField.refine((value) => value != null, "请选择开学日"),
});
