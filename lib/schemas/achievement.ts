import { z } from "zod";
import {
  checkboxField,
  dateOnlyField,
  levelEnum,
  optionalScore,
  optionalText,
} from "@/lib/schemas/project";

const achievementTypeEnum = z.enum([
  "PAPER",
  "REPORT",
  "TEXTBOOK",
  "CASE",
  "PATENT",
  "SOFTWARE_COPYRIGHT",
  "AWARD",
  "COURSE",
  "STUDENT_ACHIEVEMENT",
  "MEDIA_REPORT",
  "FUNDING_RECEIPT",
  "TRAINING",
  "SOCIAL_SERVICE",
  "OTHER",
]);

const achievementStatusEnum = z.enum([
  "PLANNED",
  "TITLED",
  "WRITING",
  "DRAFTED",
  "CHECKING",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REVISING",
  "ACCEPTED",
  "PUBLISHED",
  "INDEXED",
  "REJECTED",
  "SHELVED",
]);

/** 表单里的数字字段，空字符串当没填 */
const optionalInt = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value == null || (Number.isInteger(value) && value >= 0), "请填写非负整数");

/**
 * 外键下拉。空字符串表示"不挂"，是有意义的一档：
 * 挂不上职称指标 == 这条评职称用不上。
 */
const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

/**
 * 列表页行内订正的字段。
 *
 * **只放梳理时最常改的几项**：年度、类型、级别、用途、职称指标与职称分。
 * 完整表单二十多个字段，塞不进一行，也没必要——改期刊名、字数那些得进详情页。
 *
 * 职称指标在这里是有原因的：把 70 条成果分成「能评职称」和「只能算绩效」，
 * 就是靠逐条给它挂或不挂指标，这活儿在列表页一行行过最快。
 */
export const achievementQuickEditSchema = z.object({
  year: optionalInt,
  type: achievementTypeEnum,
  /**
   * 状态。**清存量必须有它**——导入进来的 68 条状态还是「选题」，
   * 而导出预检会把它们全标成「状态存疑」。没有这一项，用户只能一条条
   * 进详情页改，24 条就是 24 次跳转。
   */
  status: achievementStatusEnum,
  level: levelEnum,
  /**
   * 绩效小类。和职称指标对称：口径过滤只看它挂没挂上，完全不看分值，
   * 所以「填了绩效分却没挂绩效分类」的记录压根进不了绩效表。
   * 以前这一项只能在详情页改，行内订正补不上。
   */
  perfCategoryId: optionalId,
  promotionCategoryId: optionalId,
  promotionScore: optionalScore,
  /**
   * 申报分（绩效口径）。**与 promotionScore 分属两套口径，绝不互相赋值**——
   * 一个是二级学院分钱的表，一个是人事处评职称的量化表。
   *
   * 和职称那两个字段一样**故意不给 .optional()**：表单漏渲染时当场报错，
   * 好过静默把已填好的分清成 null（见 forms.test.ts 里守这条约定的用例）。
   */
  declaredScore: optionalScore,
  usableForPerformance: checkboxField,

  usableForPromotion: checkboxField,
  usableForProjectClosing: checkboxField,
  // 订正过就算核实过——导入进来的记录全是 isVerified=false，
  // 人工过一遍就该翻过来，否则这个标记永远没人清
  isVerified: checkboxField,
});

export const achievementFormSchema = z.object({
  type: achievementTypeEnum,
  title: z.string().trim().min(1, "请填写成果题目"),
  status: achievementStatusEnum,
  authorPosition: optionalInt,
  ownerRole: optionalText,
  level: levelEnum,
  journalName: optionalText,
  journalLevel: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(levelEnum.nullable()),
  indexedBy: optionalText,
  wordCount: optionalInt,
  /**
   * 两套分类各一个外键、各一个分值。**它们是两套坐标系，不许互推、不许相加**
   * （CLAUDE.md 第 11 条）：左边人事处评职称，右边二级学院分钱。
   *
   * 两边都是单选——赋分细则说明第 3 条「同一成果适合多个项目时仅按一个项目计算」。
   * 表达「这条能用在哪些场景」的是多选的 `usableFor`，那是另一个维度。
   */
  promotionCategoryId: optionalId,
  promotionScore: optionalScore,
  perfCategoryId: optionalId,
  declaredScore: optionalScore,
  completedAt: dateOnlyField,
  publishedAt: dateOnlyField,
  dateText: optionalText,
  datePrecision: z.enum(["DAY", "MONTH", "YEAR", "RANGE", "UNKNOWN"]),
  /** 顿号或逗号分隔的「可用于」标签 */
  tags: z
    .string()
    .trim()
    .transform((value) =>
      value === "" ? [] : value.split(/[、,，]/).map((t) => t.trim()).filter(Boolean),
    ),
  evidenceRef: optionalText,
  obsidianPath: optionalText,
  /** 绩效系统 / 飞书多维表格里的对应记录，方便日后对账 */
  externalRef: optionalText,
  isVerified: checkboxField,
  note: optionalText,
});

export type AchievementFormValues = z.infer<typeof achievementFormSchema>;
