import { z } from "zod";

const eventYearField = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "年度必须是四位十进制数字")
  .transform(Number)
  .refine((value) => value >= 2000, "年度不能早于 2000")
  .refine((value) => value <= 2100, "年度不能晚于 2100");

const declaredScoreField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value == null || /^-?\d+(?:\.\d{1,2})?$/.test(value),
    "申报分须为普通十进制，最多两位小数",
  )
  .transform((value) => (value == null ? null : Number(value)))
  .refine(
    (value) => value == null || Math.abs(value) <= 9999.99,
    "申报分绝对值不能超过 9999.99",
  );

export const projectPerformanceFormSchema = z.object({
  kind: z.enum(["APPLY", "APPROVED", "FUNDING", "CLOSEOUT", "OTHER"]),
  year: eventYearField,
  perfCategoryId: z.string().trim().min(1, "请选择绩效小类"),
  declaredScore: declaredScoreField,
});
