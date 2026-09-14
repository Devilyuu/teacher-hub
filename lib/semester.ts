/**
 * 教学周推算。纯函数，不碰数据库——首页问候行和设置页共用同一套口径，
 * 不许在组件里另算一遍。
 *
 * 口径：开学日（Semester.startDate）就是第 1 教学周的第一天，
 * 之后每满 7 天进一周。周的边界跟着开学日的星期走：开学日是周一，
 * 教学周就是周一到周日——这正是排课表的口径。
 */
import { diffInDays } from "@/lib/date";

export type SemesterLike = { name: string; startDate: Date };

/**
 * 超过这个周数就不再报教学周。一学期连考试周撑死二十来周，
 * 到第 26 周还在涨基本是假期里忘了设新学期——报一个「第 28 教学周」
 * 比不报更误导。这是第 8 条铁律的口径：宁可不显示，
 * 也不显示一个看起来精确的错数。
 */
export const MAX_TEACHING_WEEKS = 25;

/** 今天在该学期里是第几教学周；开学前或超出量程返回 null */
export function teachingWeek(startDate: Date, today: Date): number | null {
  const days = diffInDays(today, startDate);
  if (days < 0) return null;
  const week = Math.floor(days / 7) + 1;
  return week > MAX_TEACHING_WEEKS ? null : week;
}

export type SemesterStatus =
  | { kind: "week"; name: string; week: number }
  | { kind: "upcoming"; name: string; startDate: Date };

/**
 * 首页问候行要显示的学期状态。
 *
 * - 已开学且在量程内 → 「{name} · 第 N 教学周」
 * - 还没开学（或上学期早已收尾）但设了下一个学期 → 「{name} · X月X日开学」
 * - 都不是 → null，问候行只显示日期
 *
 * 「当前学期」取开学日 ≤ 今天中最晚的那个；「下一个学期」取开学日 > 今天
 * 中最早的那个。假期里两头都可能有值，此时上学期已超量程、自然落到后者。
 */
export function semesterStatus(
  semesters: SemesterLike[],
  today: Date,
): SemesterStatus | null {
  let current: SemesterLike | null = null;
  let upcoming: SemesterLike | null = null;
  for (const semester of semesters) {
    if (semester.startDate.getTime() <= today.getTime()) {
      if (!current || semester.startDate > current.startDate)
        current = semester;
    } else if (!upcoming || semester.startDate < upcoming.startDate) {
      upcoming = semester;
    }
  }

  if (current) {
    const week = teachingWeek(current.startDate, today);
    if (week != null) return { kind: "week", name: current.name, week };
  }
  if (upcoming) {
    return {
      kind: "upcoming",
      name: upcoming.name,
      startDate: upcoming.startDate,
    };
  }
  return null;
}
