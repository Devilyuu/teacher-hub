import type { SchoolRewardDomain } from "@/lib/generated/prisma/enums";

export const SCHOOL_REWARD_DOMAIN_LABELS: Record<SchoolRewardDomain, string> = {
  PARTY_IDEOLOGY: "党建与思想政治",
  TEACHING: "教育教学",
  RESEARCH: "科学研究",
  SOCIAL_SERVICE: "社会服务",
  COMPREHENSIVE_HONOR: "综合荣誉",
};

export const SCHOOL_REWARD_DOMAIN_OPTIONS = Object.entries(
  SCHOOL_REWARD_DOMAIN_LABELS,
).map(([value, label]) => ({
  value: value as SchoolRewardDomain,
  label,
}));

/** 只认已经落库的正式审定；不从类型、等级或奖励办法反推。 */
export function isSchoolRewarded(
  decisions: ReadonlyArray<{ id: string }>,
): boolean {
  return decisions.length > 0;
}

/**
 * 学校奖励只排除二级学院绩效。职称口径仍只看是否挂了职称指标，
 * 不能把学校奖励状态混进职称判定。
 */
export function canUseForPromotion(input: {
  promotionCategoryId: string | null;
  schoolRewarded: boolean;
}): boolean {
  return input.promotionCategoryId != null;
}
