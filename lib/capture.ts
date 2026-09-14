/**
 * 快速记录收件箱的规则（二期规格 §6.1、§7.1）。
 *
 * 纯函数，不碰数据库。首页和收件箱页共用同一套判定，
 * 不许在组件里另写一遍——两处口径分叉就会出现「首页说有 3 条待处理、
 * 点进去是 5 条」这种事。
 */
import { todayAsDateOnly } from "@/lib/date";

export type CaptureKind = "TASK" | "ACHIEVEMENT" | "NOTE";
export type CaptureStatus = "INBOX" | "SNOOZED" | "CONVERTED" | "DISMISSED";

/** 判定用得到的最小形状。故意不依赖 Prisma 类型，测试才好造数据 */
export type CaptureLike = {
  status: CaptureStatus;
  snoozedUntil: Date | null;
};

export const CAPTURE_KIND_LABELS: Record<CaptureKind, string> = {
  TASK: "待办",
  ACHIEVEMENT: "成果线索",
  NOTE: "随记",
};

/** 转换后落到哪个正式实体上，用于界面文案 */
export const CAPTURE_TARGET_LABELS: Record<CaptureKind, string> = {
  TASK: "任务",
  ACHIEVEMENT: "成果",
  NOTE: "会议",
};

/**
 * 这条速记现在该不该出现在收件箱里。
 *
 * `INBOX` 一律要；`SNOOZED` 只有到期了才回来——**延期的意思是「今天别烦我」，
 * 不是「删掉」**，所以到期必须自己浮回来，否则延期一次就等于永远消失。
 *
 * 比较用 `todayAsDateOnly()` 的 UTC 纯日期口径（`snoozedUntil` 是 `@db.Date`）。
 * 用 `new Date()` 直接比会差一天：那是带时刻的本地时间戳，和纯日期列不是一个东西。
 */
export function isPendingCapture(item: CaptureLike, today: Date = todayAsDateOnly()): boolean {
  if (item.status === "INBOX") return true;
  if (item.status !== "SNOOZED") return false;
  // 延期时没填日期的按「明天再说」处理不了，只能当作待处理，避免它彻底消失
  if (item.snoozedUntil == null) return true;
  return item.snoozedUntil.getTime() <= today.getTime();
}

/** 待处理的速记，按记录时间正序——先记的先处理，避免旧条目沉底 */
export function pendingCaptures<T extends CaptureLike & { createdAt: Date }>(
  items: T[],
  today: Date = todayAsDateOnly(),
): T[] {
  return items
    .filter((item) => isPendingCapture(item, today))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * 首页每个分区的显示上限（规格 §7.2）。
 *
 * 超出的不是丢掉，是显示「还有 N 条」并链到完整列表。库里有 70 条未核实成果，
 * 全铺在首页会把「今天要处理」挤到屏幕外，整个队列就失去意义了。
 */
export const HOME_SECTION_LIMIT = 8;

export type Capped<T> = {
  shown: T[];
  /** 没显示出来的条数。0 表示全显示完了 */
  overflow: number;
};

export function capForHome<T>(items: T[], limit: number = HOME_SECTION_LIMIT): Capped<T> {
  return {
    shown: items.slice(0, limit),
    overflow: Math.max(0, items.length - limit),
  };
}
