import { z } from "zod";
import { dateOnly } from "@/lib/date";

const optionalText = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  },
  z.string().nullable(),
);

const approvedDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "审定日期必须是 YYYY-MM-DD")
  .transform((value) => {
    const [year, month, day] = value.split("-").map(Number);
    return { value, date: dateOnly(year, month, day) };
  })
  .refine(
    ({ value, date }) => date.toISOString().slice(0, 10) === value,
    "审定日期不是有效日历日期",
  )
  .transform(({ date }) => date);

const optionalNonNegativeAmount = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine(
    (value) => value == null || /^\d+(?:\.\d{1,2})?$/.test(value),
    "奖励金额须为非负十进制，最多两位小数",
  )
  .transform((value) => (value == null ? null : Number(value)))
  .refine(
    (value) => value == null || value <= 9_999_999_999.99,
    "奖励金额不能超过 9999999999.99 元",
  );

/** 表单只录学校已经正式审定通过的事实，不承载申请或待审批状态。 */
export const schoolRewardFormSchema = z.object({
  approvedAt: approvedDateField,
  batch: optionalText,
  domain: z.enum([
    "PARTY_IDEOLOGY",
    "TEACHING",
    "RESEARCH",
    "SOCIAL_SERVICE",
    "COMPREHENSIVE_HONOR",
  ]),
  awardItem: z.string().trim().min(1, "请填写奖励项目"),
  awardLevel: optionalText,
  awardAmountYuan: optionalNonNegativeAmount,
  evidenceRef: optionalText,
  note: optionalText,
});
