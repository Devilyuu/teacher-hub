import { z } from "zod";
import {
  COMPETITION_AWARD_LABELS,
  COMPETITION_STATUS_LABELS,
} from "@/lib/labels";
import { dateOnlyField, levelEnum, optionalText } from "@/lib/schemas/project";

/**
 * 指导参赛模块的表单校验。
 *
 * 两条贯穿本文件的取舍：
 * - **日期宁可留空不猜**（第 8 条铁律）。报名截止只在精确到日时才填，
 *   比赛日期和获奖日配 dateText + 精度那一套。
 * - **结果与阶段是两个字段**：status 说走到哪一步，award 说拿了什么，
 *   谁也不从对方推导（第 1 条铁律：只计算不判定）。
 */

/** 从中文映射表派生，不再手抄一遍取值（同 levelEnum 的做法） */
export const competitionStatusEnum = z.enum(
  Object.keys(COMPETITION_STATUS_LABELS) as [
    keyof typeof COMPETITION_STATUS_LABELS,
    ...(keyof typeof COMPETITION_STATUS_LABELS)[],
  ],
);

/**
 * 奖项。**空串是「还没出结果」，不是校验失败**——刚报上名的记录本来就没有奖项，
 * 而 `NONE`（未获奖）是另一件事：比完了，没拿到
 */
export const competitionAwardField = z
  .enum([
    "",
    ...(Object.keys(COMPETITION_AWARD_LABELS) as (keyof typeof COMPETITION_AWARD_LABELS)[]),
  ])
  .transform((value) => (value === "" ? null : value));

/** 赛事字典。名称不含赛项和届次——那两样每年变，在参赛记录上 */
export const competitionFormSchema = z.object({
  name: z.string().trim().min(1, "请填写赛事名称").max(120, "赛事名称太长了"),
  organizer: optionalText,
  level: levelEnum,
  note: optionalText,
});

export const competitionEntryFormSchema = z.object({
  /** 已有赛事的 id；选「新增」时为空，由 newCompetitionName 兜底（同 sourceId） */
  competitionId: optionalText,
  newCompetitionName: optionalText,

  track: optionalText,
  /**
   * 年度。**必填**——历年分组、统计、职称清单全靠它。
   * 范围卡在 1990–2100：打错成 202 或 20266 的那一下，界面会排到列表尽头去
   */
  year: z
    .string()
    .trim()
    .min(1, "请填写年度")
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isInteger(value) && value >= 1990 && value <= 2100,
      "年度应是 1990—2100 之间的四位数",
    ),
  editionText: optionalText,
  level: levelEnum,
  status: competitionStatusEnum,

  /** 精确到日才填，只知道「五月底」就留空写进 note */
  registerDeadline: dateOnlyField,

  competeAt: dateOnlyField,
  competeDateText: optionalText,

  award: competitionAwardField,
  awardTitle: optionalText,
  awardedAt: dateOnlyField,
  awardDateText: optionalText,

  /**
   * 本人第几指导。空 = 没填，不是 0。
   * 不设上限硬校验——有些赛项署名就是能排到第五
   */
  myOrder: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .refine(
      (value) => value == null || (Number.isInteger(value) && value >= 1),
      "指导教师排名应是 1 起的整数",
    ),

  note: optionalText,
}).refine(
  (data) => (data.competitionId ?? "") !== "" || (data.newCompetitionName ?? "") !== "",
  { message: "请选择赛事，或填一个新赛事名", path: ["competitionId"] },
);

/**
 * 参赛学生名单：一行一个，姓名后可跟备注（制表符 / 中英文逗号 / 顿号分隔）。
 *
 * **按整块文本收不按一行一个输入框**：队员就三五个人，改一次名单比
 * 加减输入框快得多；和班主任的批量粘贴导入是同一个取舍。
 */
export const competitionMembersSchema = z.object({
  members: z.string(),
});

/** 姓名永远是真相，关联只是锦上添花（见 schema 里 CompetitionMember 的注释） */
export type ParsedMember = { name: string; note: string | null };

/**
 * 解析队员名单。分隔符跟着班主任那份走：制表符、中英文逗号、顿号。
 * 同名跳过——一支队里不会有两个同名队员，重复粘贴整块是安全的。
 */
export function parseMemberList(raw: string): ParsedMember[] {
  const seen = new Set<string>();
  const out: ParsedMember[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cells = line
      .split(/[\t,，、]/)
      .map((cell) => cell.trim())
      .filter((cell) => cell !== "");
    if (cells.length === 0) continue;
    const [name, ...rest] = cells;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, note: rest.length > 0 ? rest.join(" ") : null });
  }
  return out;
}
