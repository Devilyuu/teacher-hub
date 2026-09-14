/**
 * 首页顶部四张数字卡的强调规则。
 *
 * 纯函数，不碰数据库——理由和 lib/capture.ts 一样：口径只写一遍，
 * 组件只消费结果。
 */

/** 四张卡的固定顺序，同时也是它们的标识 */
export type HomeStatKey = "dueToday" | "overdue" | "weekMeetings" | "dueSoon";

export type HomeStatValues = Record<HomeStatKey, number>;

/**
 * 哪张卡该被强调（实心墨黑那张）。
 *
 * **强调必须跟着紧急度走，不能钉死在第一格。** 原来第一张「今日到期」
 * 恒为实心：今天一件事没到期时，那个大大的 `0` 是全屏最重的元素，
 * 而右边真正逾期的那条是张平白卡——视觉权重和紧急度正好相反。
 *
 * 优先级：逾期 > 今日到期。**两样都是 0 时谁也不强调**——
 * 没有急事就是没有急事，不必硬挑一张涂黑。剩下两张（本周会议、
 * 90 天内到期）永远不强调：它们是节奏信息，不是今天要动手的事。
 */
export function emphasizedStat(values: HomeStatValues): HomeStatKey | null {
  if (values.overdue > 0) return "overdue";
  if (values.dueToday > 0) return "dueToday";
  return null;
}
