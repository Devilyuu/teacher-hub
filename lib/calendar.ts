/**
 * 月历的格子计算（prd-routines 3）。
 *
 * **合并后这个视图的价值才成立**：原来只有会议和轮派，现在能把课题结题截止日、
 * 申报截止日一起铺上去——「这个月要交什么」和「这个月要开什么会」本来就该在一屏里。
 *
 * 纯函数，日期一律走 lib/date.ts 的 UTC 纯日期口径。
 */
import { dateOnly, diffInDays, formatDateOnly, todayAsDateOnly } from "@/lib/date";

/** 日历上的一件事。五种来源共用一个形状，颜色和跳转由界面决定 */
export type CalendarEvent = {
  id: string;
  /** classSession = 课表上的一个半天（lib/timetable.ts 推算，不是存的事件） */
  kind:
    | "meeting"
    | "classSession"
    | "duty"
    | "projectDeadline"
    | "taskDue"
    /** 参赛的报名截止与比赛日期。和课题截止同属「不能错过」那一档 */
    | "competition"
    /** 学生项目的开题/中期/答辩。**只有填了精确日期的才进来**（第 8 条铁律） */
    | "menteeMilestone";
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** 会议才有的时刻，如 "14:30" */
  time?: string;
  href: string;
  note?: string;
};

export type CalendarCell = {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  /** 是否属于当前显示的月份。前后补齐的格子为 false */
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};

/** 月份的第一天与最后一天（纯日期） */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: dateOnly(year, month, 1),
    // 下个月的第 0 天 = 这个月最后一天
    to: new Date(Date.UTC(year, month, 0)),
  };
}

/**
 * 排出整月的格子，**按周一起头补满整周**——月历缺了首尾的补齐格会错位，
 * 而错位的日历没人看得懂。
 */
export function buildMonthGrid(
  year: number,
  month: number,
  events: CalendarEvent[],
  now: Date = new Date(),
): CalendarCell[] {
  const { from, to } = monthRange(year, month);
  const todayYmd = formatDateOnly(todayAsDateOnly(now));

  // 周一 = 0 列。getUTCDay 里周日是 0，要换算
  const leading = (from.getUTCDay() + 6) % 7;
  const start = new Date(from.getTime() - leading * 86_400_000);

  // 补到整周：末尾同理
  const trailing = 6 - ((to.getUTCDay() + 6) % 7);
  const end = new Date(to.getTime() + trailing * 86_400_000);

  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  }

  const cells: CalendarCell[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t);
    const ymd = formatDateOnly(day);
    cells.push({
      date: ymd,
      day: day.getUTCDate(),
      inMonth: day.getUTCMonth() + 1 === month && day.getUTCFullYear() === year,
      isToday: ymd === todayYmd,
      events: sortEvents(byDate.get(ymd) ?? []),
    });
  }
  return cells;
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export type AgendaDay = CalendarCell & { weekday: string };

/**
 * 手机上的月历：同一份格子压成「按天列表」，**只留本月有安排的日子**。
 *
 * 七列网格在 390px 宽的屏上要横滑两屏多（2026-09-14 审核报告），而横滑时
 * 左边的周一早就滑出去了，看不出哪天是周几。照宽表的处方换成列表：
 * 数据用同一份 `buildMonthGrid` 的结果，手机和桌面看同一天必须是同几条。
 *
 * - 补齐格（上月末、下月初）不进列表：列表没有网格的错位问题，不需要它们
 * - 没安排的日子不列：一个月三十行里二十行空着，有事的那几天反而要往下翻
 * - **今天没安排也列出来**：它是打开月历时眼睛找的锚点，
 *   没有它就分不清「今天之前」和「今天之后」
 */
export function monthAgenda(cells: CalendarCell[]): AgendaDay[] {
  return cells
    .filter((cell) => cell.inMonth && (cell.events.length > 0 || cell.isToday))
    .map((cell) => ({
      ...cell,
      weekday: WEEKDAY_LABELS[new Date(`${cell.date}T00:00:00Z`).getUTCDay()],
    }));
}

/** 同一天里：会议按时刻排在前（有确定时间），上课紧随其后（占的是半天），其余按类型稳定排序 */
const KIND_RANK: Record<CalendarEvent["kind"], number> = {
  meeting: 0,
  classSession: 1,
  duty: 2,
  // 截止类排在活动类后面、任务前面：同一天里先看「要去哪」，再看「要交什么」
  projectDeadline: 3,
  competition: 4,
  menteeMilestone: 5,
  taskDue: 6,
};

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return a.title.localeCompare(b.title, "zh-CN");
  });
}

/** 上一个月 / 下一个月，跨年时进位 */
export function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const zero = year * 12 + (month - 1) + delta;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}

/** URL 上的 `?m=2026-07` 解析成年月，坏值退回当月 */
export function parseMonthParam(value: string | null, now: Date = new Date()): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return [year, month];
  }
  return [now.getFullYear(), now.getMonth() + 1];
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 距今天还有几天，用来决定截止日要不要标出来 */
export function daysFromToday(ymd: string, now: Date = new Date()): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return diffInDays(dateOnly(year, month, day), todayAsDateOnly(now));
}
