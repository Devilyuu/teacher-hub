/**
 * 结题要求项能选哪些成果类型（设计 `2026-07-31-horizontal-project-funding-receipt`）。
 *
 * 界面和 Server Action 共用这一份名单：两边各维护一份，早晚会漂——
 * 界面藏起来的选项服务端照收，或者反过来，用户在界面上选得到却存不进去。
 *
 * **这不是「系统替人判定」**（CLAUDE.md 第 1 条）。这里管的是"这个选项存不存在"，
 * 和 zod 只认 14 个枚举值是同一类事；到账多少算达标，仍然只由人工勾
 * `RequirementLink.isQualified` 决定。
 */
import { ACHIEVEMENT_TYPE_LABELS } from "@/lib/labels";
import type { AchievementType, FundingType } from "@/lib/generated/prisma/enums";

/**
 * 不分课题类型都能选的那几类。
 *
 * 划出去的是**结题验收不会认的**：媒体报道、培训讲座、社会服务、指导学生，
 * 没有哪份立项文件会把它们写成结题条件。到账经费不在这份名单里，
 * 但它有自己的口子，见下。
 */
const ALWAYS_LINKABLE = new Set<AchievementType>([
  "PAPER",
  "REPORT",
  "TEXTBOOK",
  "CASE",
  "PATENT",
  "SOFTWARE_COPYRIGHT",
  "AWARD",
  "COURSE",
  "OTHER",
]);

/**
 * 只有横向课题能选的类型。
 *
 * 横向合同的结题条件常常就是"研发经费 20 万元分两期到账"——那是甲方验收的
 * 硬杠杠，写进结题要求天经地义；纵向课题的经费是拨下来的，把它列成结题条件
 * 没有意义，摆在按钮里只会让人选错。
 */
const HORIZONTAL_ONLY = new Set<AchievementType>(["FUNDING_RECEIPT"]);

/** 枚举的规范顺序，界面按钮和服务端名单都跟着它走（其他垫底） */
const TYPE_ORDER = Object.keys(ACHIEVEMENT_TYPE_LABELS) as AchievementType[];

/** 这个课题类型下，结题要求能选的成果类型 */
export function linkableAchievementTypes(fundingType: FundingType): AchievementType[] {
  return TYPE_ORDER.filter(
    (type) =>
      ALWAYS_LINKABLE.has(type) || (fundingType === "HORIZONTAL" && HORIZONTAL_ONLY.has(type)),
  );
}

/**
 * 提交上来的类型里，哪些这个课题不该有。
 *
 * **只挑「横向专属」那几类**，不顺手把名单收紧成 `linkableAchievementTypes` 的
 * 补集：存量要求项里可能存着当年从别处导进来的类型，一律收紧的话，
 * 用户连改一个错别字都保存不了。
 */
export function rejectedRequirementTypes(
  fundingType: FundingType,
  allowedTypes: readonly AchievementType[],
): AchievementType[] {
  if (fundingType === "HORIZONTAL") return [];
  return [...new Set(allowedTypes.filter((type) => HORIZONTAL_ONLY.has(type)))];
}

/** 拒绝时给人看的话。说清是哪个类型、为什么不行 */
export function rejectedRequirementTypesMessage(types: readonly AchievementType[]): string {
  const names = types.map((type) => `「${ACHIEVEMENT_TYPE_LABELS[type]}」`).join("、");
  return `${names}只有横向课题的结题要求能用`;
}
