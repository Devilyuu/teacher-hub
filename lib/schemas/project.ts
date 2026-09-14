import { z } from "zod";
import { dateOnly } from "@/lib/date";
import { LEVEL_LABELS, PROJECT_STATUS_LABELS } from "@/lib/labels";

/**
 * 表单里的日期是 `<input type="date">` 传来的 "YYYY-MM-DD" 字符串，
 * 必须转成 UTC 午夜才能写进 @db.Date 列，否则倒计时会差一天（见 lib/date.ts）。
 * 空字符串代表"没填"，转成 null。
 */
export const dateOnlyField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value == null || /^\d{4}-\d{2}-\d{2}$/.test(value), "日期格式应为 YYYY-MM-DD")
  .transform((value) => {
    if (value == null) return null;
    const [year, month, day] = value.split("-").map(Number);
    return dateOnly(year, month, day);
  });

/** 空字符串一律当作"没填"，别往库里塞空串 */
export const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

/**
 * 量化分。**允许小数也允许负数**——赋分细则里有 0.1、1.2、0.8 这类分值，
 * 也有「Ⅰ级教学事故扣3分」这种扣分项，说明第 8 条还写了「扣分项不设下限」。
 */
export const optionalScore = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value == null || Number.isFinite(value), "请填写数字");

/** 表单里的正整数字段（排名、人数），空字符串当没填 */
export const optionalPositiveInt = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value == null || (Number.isInteger(value) && value >= 1), "请填写正整数");

/**
 * 复选框。未勾选时**这个 key 根本不会出现在 FormData 里**，
 * 所以必须 `.optional()`——只写 `z.union([..., z.undefined()])` 在 zod v4 里
 * 仍然要求 key 存在，会报 "expected nonoptional, received undefined"。
 */
export const checkboxField = z
  .literal(["on", "true"])
  .optional()
  .transform((value) => value != null);

/**
 * 从中文映射表派生，而不是再手抄一份取值。
 * LEVEL_LABELS 用 `satisfies Record<Level, string>` 锁着完整性，
 * schema.prisma 改了枚举这里会跟着变，不会像上次那样漏掉一处。
 */
export const levelEnum = z.enum(
  Object.keys(LEVEL_LABELS) as [keyof typeof LEVEL_LABELS, ...(keyof typeof LEVEL_LABELS)[]],
);

/** 同上，从映射表派生。加 REJECTED 时这里不用改，是这么写的目的 */
export const projectStatusEnum = z.enum(
  Object.keys(PROJECT_STATUS_LABELS) as [
    keyof typeof PROJECT_STATUS_LABELS,
    ...(keyof typeof PROJECT_STATUS_LABELS)[],
  ],
);

export const projectFormSchema = z
  .object({
    title: z.string().trim().min(1, "请填写课题全称"),
    shortTitle: optionalText,
    code: optionalText,
    level: levelEnum,
    category: z.enum(["RESEARCH", "TEACHING_REFORM", "EDU_RESEARCH", "OTHER"]),
    fundingType: z.enum(["VERTICAL", "HORIZONTAL"]),
    /** 已有来源的 id；选「新增」时为空，由 newSourceName 兜底 */
    sourceId: optionalText,
    /** 现场新增的来源单位名。填了就优先用它 */
    newSourceName: optionalText,
    hostUnit: optionalText,
    ownerOrder: optionalPositiveInt,
    memberCount: optionalPositiveInt,
    role: z.enum(["LEAD", "CO_LEAD", "MEMBER"]),
    status: projectStatusEnum,
    applyDeadline: dateOnlyField,
    startDate: dateOnlyField,
    endDate: dateOnlyField,
    closingDeadline: dateOnlyField,
    /**
     * 职称量化指标（正常是 5.2 纵向课题 / 5.3 横向项目和知识产权）与分值。
     *
     * **课题的职称分挂在课题自己身上，不派生成果记录**——附件2 的 5.2 是
     * 「每项加 N 分」，按项赋分，不是立项一次结题一次。
     *
     * 空值有意义：表示这个课题不计入职称量化。
     */
    promotionCategoryId: optionalText,
    promotionScore: optionalScore,
    researchContent: optionalText,
    note: optionalText,
  })
  // 排在第 7 位却只有 6 个人，多半是打错了。软性挡一下，省得台账里出现 7/6
  .refine(
    (data) =>
      data.ownerOrder == null || data.memberCount == null || data.ownerOrder <= data.memberCount,
    { path: ["ownerOrder"], message: "本人排名不能大于成员总数" },
  );

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

/** 横向项目才有到账金额可谈；纵向的经费走 fundingTotal，Phase 3 再说 */
export const HORIZONTAL_ONLY_FIELDS = ["fundingReceived"] as const;
