import { z } from "zod";
import { dateOnly } from "@/lib/date";

/**
 * 教案回流载荷（规格 §7.6，设计见
 * `docs/superpowers/specs/2026-08-05-teaching-import-design.md`）。
 *
 * 调用方是**外部系统**，不是本平台的表单。所以这里比其它 schema 更严：
 * 长度全部设上限、日期只认 `YYYY-MM-DD`，不做任何宽容解析——
 * 对内部表单来说"猜用户想填什么"是体贴，对外部接口来说是把脏数据放进库里。
 */

/** `YYYY-MM-DD` → 纯日期 Date。**必须走 dateOnly**，否则倒计时会差一天（代码约定） */
const dateOnlyString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "完成日期必须是 YYYY-MM-DD")
  .transform((value, ctx) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const parsed = dateOnly(year, month, day);
    // dateOnly 不校验月末，2026-02-31 会滚到 3 月。滚过头就说明日期本身不存在
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      ctx.addIssue({ code: "custom", message: "完成日期不存在" });
      return z.NEVER;
    }
    return parsed;
  });

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}最多 ${max} 个字符`)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

export const teachingImportPayloadSchema = z.object({
  /** 幂等键的一半。限制字符集：它会进磁盘路径的兄弟目录名判断和日志 */
  externalSystem: z
    .string()
    .trim()
    .min(1, "缺少来源系统标识")
    .max(64, "来源系统标识最多 64 个字符")
    .regex(/^[a-zA-Z0-9._-]+$/, "来源系统标识只能是字母、数字、点、下划线和连字符"),
  /** 幂等键的另一半，由对方决定，只做长度与空白约束 */
  externalId: z
    .string()
    .trim()
    .min(1, "缺少外部记录标识")
    .max(128, "外部记录标识最多 128 个字符"),
  title: z.string().trim().min(1, "缺少教案标题").max(200, "教案标题最多 200 个字符"),
  courseName: optionalTrimmed(100, "课程名"),
  /**
   * 学期，形如 `2025-2026 第二学期`。
   *
   * 它一直都在 `note` 里，但那是拼给人读的一整串（学期 · 班级 · 摘要），拆不出来。
   * 一门课教了几个学期正是要分开看的东西，所以单独收一份。
   *
   * **这里不校验格式**：规范化是备课系统那边的事（`normalize_term()`），
   * 而外部系统未必只有它一个。收一个有长度上限的字符串，怎么排怎么分组由读的人定。
   */
  term: optionalTrimmed(50, "学期"),
  finishedAt: dateOnlyString.optional(),
  note: optionalTrimmed(1000, "说明"),
});

export type TeachingImportPayload = z.infer<typeof teachingImportPayloadSchema>;

/**
 * 落库的 `payload`：**显式挑字段，绝不整体转存请求**。
 *
 * 整体转存会把 `Authorization` 一起写进库，而那是没有任何症状的——
 * 直到某天全库 JSON 备份（增量 3.8）把令牌一起送出门。
 */
export function auditPayload(input: TeachingImportPayload): Record<string, unknown> {
  return {
    externalSystem: input.externalSystem,
    externalId: input.externalId,
    title: input.title,
    ...(input.courseName === undefined ? {} : { courseName: input.courseName }),
    ...(input.term === undefined ? {} : { term: input.term }),
    // 存回 YYYY-MM-DD 原样，别存 Date——JSON 里会变成带时刻的 ISO 串，
    // 看起来像是精确到秒，而它本来只是一天
    ...(input.finishedAt === undefined
      ? {}
      : { finishedAt: input.finishedAt.toISOString().slice(0, 10) }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

/** 「引用为成果」表单：预填教案标题，类型和年度由用户定 */
export const adoptTeachingImportSchema = z.object({
  importId: z.string().trim().min(1),
  title: z.string().trim().min(1, "请填写成果名称").max(200, "成果名称最多 200 个字符"),
  type: z.string().trim().min(1, "请选择成果类型"),
  year: z
    .string()
    .trim()
    .regex(/^(?:19|20|21)\d{2}$/, "请填写四位年份")
    .transform(Number),
});
