import { z } from "zod";
import { MEETING_TYPE_LABELS } from "@/lib/labels";
import { optionalText } from "@/lib/schemas/project";

/** 从中文映射表派生，不手抄取值（同 levelEnum 的范式） */
export const meetingTypeEnum = z.enum(
  Object.keys(MEETING_TYPE_LABELS) as [
    keyof typeof MEETING_TYPE_LABELS,
    ...(keyof typeof MEETING_TYPE_LABELS)[],
  ],
);

export const meetingFormSchema = z.object({
  title: z.string().trim().min(1, "请填写会议名称"),
  type: meetingTypeEnum,
  /** datetime-local 的原始值，由 lib/meetings.ts 的 parseMeetingTime 转时间戳 */
  meetingTime: z.string().trim().min(1, "请选择会议时间"),
});

export const resolutionFormSchema = z.object({
  text: z.string().trim().min(1, "请填写决议内容"),
  assignee: optionalText,
  /** YYYY-MM-DD，可空。转任务时变成任务的截止日 */
  dueDate: optionalText,
});
