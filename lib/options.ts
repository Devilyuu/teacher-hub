/**
 * 下拉选项。由 lib/labels.ts 的中文映射生成，
 * 保证界面上的选项和详情页显示的文案永远是同一套词。
 */
import {
  ACHIEVEMENT_STATUS_LABELS,
  COMPETITION_AWARD_LABELS,
  COMPETITION_STATUS_LABELS,
  ACHIEVEMENT_TYPE_LABELS,
  ACHIEVEMENT_USAGE_LABELS,
  ATTACHMENT_KIND_LABELS,
  DATE_PRECISION_LABELS,
  DECLARE_NATURE_LABELS,
  FUNDING_TYPE_LABELS,
  LEVEL_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_ROLE_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import { linkableAchievementTypes } from "@/lib/requirement-types";
import type { FundingType } from "@/lib/generated/prisma/enums";

export type Option = { value: string; label: string };

function toOptions(labels: Record<string, string>): Option[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const LEVEL_OPTIONS = toOptions(LEVEL_LABELS);
export const PROJECT_CATEGORY_OPTIONS = toOptions(PROJECT_CATEGORY_LABELS);
export const FUNDING_TYPE_OPTIONS = toOptions(FUNDING_TYPE_LABELS);
export const PROJECT_ROLE_OPTIONS = toOptions(PROJECT_ROLE_LABELS);
export const PROJECT_STATUS_OPTIONS = toOptions(PROJECT_STATUS_LABELS);
export const ACHIEVEMENT_TYPE_OPTIONS = toOptions(ACHIEVEMENT_TYPE_LABELS);
export const ACHIEVEMENT_STATUS_OPTIONS = toOptions(ACHIEVEMENT_STATUS_LABELS);
export const DATE_PRECISION_OPTIONS = toOptions(DATE_PRECISION_LABELS);
export const ATTACHMENT_KIND_OPTIONS = toOptions(ATTACHMENT_KIND_LABELS);
export const DECLARE_NATURE_OPTIONS = toOptions(DECLARE_NATURE_LABELS);
export const ACHIEVEMENT_USAGE_OPTIONS = toOptions(ACHIEVEMENT_USAGE_LABELS);
export const COMPETITION_STATUS_OPTIONS = toOptions(COMPETITION_STATUS_LABELS);
export const COMPETITION_AWARD_OPTIONS = toOptions(COMPETITION_AWARD_LABELS);

/**
 * 结题要求项能挂接的成果类型，按课题的纵向 / 横向给。
 *
 * **这不是"本工具只收这几类成果"**——那是合并成平台前的旧约定（获奖、指导学生
 * 留给绩效系统），已随 CLAUDE.md 第 10 条一起作废，成果库现在收全部 14 类。
 * 这里筛掉的是**结题验收不会认的那些**：媒体报道、培训讲座、社会服务、指导学生。
 * 到账经费只对横向课题放出来，名单本身在 lib/requirement-types.ts，
 * 服务端校验用的是同一份。
 */
export function linkableAchievementTypeOptions(fundingType: FundingType): Option[] {
  const linkable = new Set<string>(linkableAchievementTypes(fundingType));
  return ACHIEVEMENT_TYPE_OPTIONS.filter((option) => linkable.has(option.value));
}
