/**
 * 周期任务的生成判定（prd-routines 2）。从 dept-cockpit 的 `lib/recurring.ts` 迁入，
 * 判定逻辑抽成纯函数以便单测；写库那半留在 `lib/queries/routines.ts`。
 *
 * **没有 cron。** 规则说的是「每周一」「每月 25 号」，在当天首次打开页面时
 * 补生成——对单人工具这就够了，省掉一个常驻进程。
 *
 * 日期一律走 `lib/date.ts` 的 UTC 纯日期口径（迁入时的改造，见 lib/tasks.ts 文件头）。
 */
import { dateOnly, diffInDays, formatDateOnly, todayAsDateOnly } from "@/lib/date";
import type { RecurringFreq } from "@/lib/generated/prisma/enums";

export type RecurringRuleLike = {
  freq: RecurringFreq;
  /** WEEKLY: 1-7（周一~周日）；MONTHLY: 1-31 */
  day: number;
  createdAt: Date;
  /** 最后生成到哪一天，YYYY-MM-DD */
  lastRunYmd: string | null;
};

/**
 * 往回找多少天。**规则错过了要补上**——每月 25 号那条，
 * 25 号那天没开电脑就得在 26 号补出来。一个月覆盖所有支持的周期。
 */
export const CATCHUP_DAYS = 31;

/** 这条规则在这一天触发吗 */
export function matchesDay(rule: RecurringRuleLike, date: Date): boolean {
  if (rule.freq === "WEEKLY") {
    // getUTCDay 里周日是 0，规则里周日是 7
    const dow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    return dow === rule.day;
  }
  // 每月：日期超出当月天数时取月末——「每月 31 号」在 4 月落在 30 号、
  // 2 月落在 28/29 号，而不是整月不触发
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return date.getUTCDate() === Math.min(rule.day, lastDay);
}

/**
 * 该补生成哪一天的任务，没有就返回 null。
 *
 * **只返回最近的那一次**：出差三周回来该看到一条待办，不是一摞过期的重复任务。
 * 边界有三条——不早于规则创建日、不早于已生成过的那天、不超出补齐窗口。
 */
export function latestDueDate(
  rule: RecurringRuleLike,
  now: Date = new Date(),
): string | null {
  const today = todayAsDateOnly(now);
  const createdYmd = formatDateOnly(
    dateOnly(rule.createdAt.getFullYear(), rule.createdAt.getMonth() + 1, rule.createdAt.getDate()),
  );

  for (let back = 0; back <= CATCHUP_DAYS; back += 1) {
    const day = new Date(today.getTime() - back * 86_400_000);
    const ymd = formatDateOnly(day);
    // 规则创建之前的日子不补
    if (ymd < createdYmd) return null;
    // 已经生成到这一天（或更晚）了
    if (rule.lastRunYmd && ymd <= rule.lastRunYmd) return null;
    if (matchesDay(rule, day)) return ymd;
  }
  return null;
}

/** 规则的人话说明，如「每周一」「每月 25 号」 */
export function describeRule(rule: Pick<RecurringRuleLike, "freq" | "day">): string {
  if (rule.freq === "WEEKLY") {
    const names = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return `每${names[rule.day] ?? `第${rule.day}天`}`;
  }
  return `每月 ${rule.day} 号`;
}

/** 距今天还有几天，负数是已过 */
export function daysUntil(dueDate: Date, now: Date = new Date()): number {
  return diffInDays(dueDate, todayAsDateOnly(now));
}
