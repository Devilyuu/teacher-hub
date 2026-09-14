/**
 * 纯日期（Prisma `@db.Date` 列）的统一处理。
 *
 * 背景：`@db.Date` 存的是没有时区的日历日，但 JS 的 Date 永远带时刻。
 * Prisma 写入时取这个 Date 的 **UTC** 年月日，读回来也给 UTC 午夜。
 * 若用 `new Date(2026, 8, 30)`（本地午夜）写入，在东八区会被算成
 * 2026-09-29T16:00Z，落库就成了 09-29——倒计时凭空少一天。
 *
 * 约定：**所有纯日期在 JS 侧一律用 UTC 午夜表示**，读、写、比较、格式化
 * 全部走本文件，不要在别处用 `new Date(y, m, d)` 或 date-fns 的本地口径函数。
 */

/** 构造纯日期。month 从 1 开始 */
export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * 取"今天"对应的纯日期。
 * 用**本地**年月日判断今天是几号（用户在东八区，今天就是他日历上的今天），
 * 再转成 UTC 午夜以便和纯日期字段比较。
 */
export function todayAsDateOnly(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** 两个纯日期相差多少天。later 在前则为正 */
export function diffInDays(later: Date, earlier: Date): number {
  return Math.round((startOfUtcDay(later) - startOfUtcDay(earlier)) / 86_400_000);
}

/**
 * 格式化纯日期为 YYYY-MM-DD。
 * 这里不能用 date-fns 的 `format`——它按本地时区取年月日，
 * 会把 UTC 午夜的 2026-09-30 在西半球渲染成 09-29。
 */
export function formatDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatYearOnly(value: Date): string {
  return `${value.getUTCFullYear()} 年`;
}

export function formatYearMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}
