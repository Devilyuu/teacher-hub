import { z } from "zod";
import { dateOnlyField, optionalText } from "@/lib/schemas/project";

export const captureKindEnum = z.enum(["TASK", "ACHIEVEMENT", "NOTE"]);

/**
 * 快速记录。**只有一个必填项**——超过一句话就不叫快速记录了（规格 §7.1：
 * 从点击到关闭不超过 30 秒）。
 */
export const captureFormSchema = z.object({
  kind: captureKindEnum.default("TASK"),
  title: z.string().trim().min(1, "写一句话就行"),
  content: optionalText,
});

/** 延期。日期必填——「延期但不说延到哪天」等于让它消失 */
export const captureSnoozeSchema = z.object({
  snoozedUntil: dateOnlyField.refine((value) => value != null, "请选择哪天再提醒"),
});

/**
 * 速记 → 学生记录（班主任模块）。类型必选；学生可空——
 * 「今天班会说了……」这类全班范围的记录不点名
 */
export const captureStudentRecordSchema = z.object({
  classGroupId: z.string().min(1),
  typeId: z.string().min(1, "选一个类型"),
  studentId: optionalText,
});
