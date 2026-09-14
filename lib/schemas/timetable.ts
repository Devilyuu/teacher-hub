import { z } from "zod";
import { parseWeeksText } from "@/lib/timetable";

const periodField = z.coerce
  .number()
  .int("节次是整数")
  .min(1, "节次从 1 开始")
  .max(14, "没有这么晚的节次");

/**
 * 手工补一条课表。周次照抄教务系统的写法（「10-13周」「13周,18-19周」），
 * 服务端展开后连原文一起存——界面显示原文，首页判断用展开的数组。
 */
export const timetableSlotFormSchema = z
  .object({
    semesterId: z.string().min(1, "缺少学期"),
    weekday: z.coerce.number().int().min(1, "选一个星期").max(7, "选一个星期"),
    periodStart: periodField,
    periodEnd: periodField,
    weeksText: z
      .string()
      .trim()
      .min(1, "周次不能为空")
      .max(64, "周次太长了")
      .refine((value) => parseWeeksText(value).length > 0, "看不懂这个周次，写成「10-13周」或「13周,18-19周」"),
    courseName: z.string().trim().min(1, "课程名不能为空").max(64, "课程名太长了"),
    className: z
      .string()
      .trim()
      .max(128, "班级太长了")
      .transform((value) => (value === "" ? null : value)),
    location: z
      .string()
      .trim()
      .max(64, "地点太长了")
      .transform((value) => (value === "" ? null : value)),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "结束节次不能早于开始节次",
    path: ["periodEnd"],
  });
