import { z } from "zod";
import {
  TASK_PRIORITY_LABELS,
  TASK_SOURCE_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { dateOnlyField, optionalText } from "@/lib/schemas/project";

/** 三个枚举一律从中文映射表派生，不手抄取值（同 levelEnum 的范式） */
function enumOf<T extends Record<string, string>>(labels: T) {
  return z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);
}

export const taskSourceEnum = enumOf(TASK_SOURCE_LABELS);
export const taskPriorityEnum = enumOf(TASK_PRIORITY_LABELS);
export const taskStatusEnum = enumOf(TASK_STATUS_LABELS);

/**
 * 任务表单。
 *
 * `relatedProjectId` 是**外键**不是自由文本（prd-routines 2 的必改项）：
 * 自由文本多打一个字就是两个项目，没法按课题聚合待办。
 * 空串转 null——「不关联任何课题」是常态，不是没填。
 */
export const taskFormSchema = z.object({
  title: z.string().trim().min(1, "请填写任务内容"),
  source: taskSourceEnum,
  priority: taskPriorityEnum,
  status: taskStatusEnum,
  dueDate: dateOnlyField,
  relatedProjectId: optionalText,
  note: optionalText,
  /** 自由标签，逗号/顿号/空格分隔，由 parseTags 拆 */
  tags: z.string().default(""),
});

export const recurringRuleFormSchema = z
  .object({
    title: z.string().trim().min(1, "请填写任务内容"),
    source: taskSourceEnum,
    priority: taskPriorityEnum,
    freq: z.enum(["WEEKLY", "MONTHLY"]),
    day: z.coerce.number().int().min(1, "请选择").max(31, "最多 31"),
    relatedProjectId: optionalText,
    note: optionalText,
  })
  // 每周只有 7 天，填 8 会导致这条规则永远不触发——静默失效比报错难查得多
  .refine((data) => data.freq !== "WEEKLY" || data.day <= 7, {
    message: "每周规则的日子只能是 1–7（周一到周日）",
    path: ["day"],
  });
