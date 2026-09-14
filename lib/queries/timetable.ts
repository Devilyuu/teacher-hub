import "server-only";
import { prisma } from "@/lib/db";
import { todayAsDateOnly } from "@/lib/date";
import { getSemesters } from "@/lib/queries/semesters";
import {
  buildWeekTimetable,
  homeTimetableWeek,
  type HomeTimetableWeek,
  type WeekTimetable,
} from "@/lib/timetable";

/** 某学期的全部课表条目，按周几、节次排 */
export function getTimetableSlots(semesterId: string) {
  return prisma.timetableSlot.findMany({
    where: { semesterId },
    orderBy: [{ weekday: "asc" }, { periodStart: "asc" }, { courseName: "asc" }],
  });
}

export type HomeTimetable = {
  week: HomeTimetableWeek;
  table: WeekTimetable;
  /** 这学期一条课表都没有：卡片改成「去导入」的空状态 */
  empty: boolean;
};

/**
 * 首页「本周课表」要的数据。学期没到显示窗口（假期、超量程）返回 null，
 * 首页就不画这张卡——口径在 lib/timetable.ts 的 homeTimetableWeek。
 */
export async function getHomeTimetable(now: Date = new Date()): Promise<HomeTimetable | null> {
  const today = todayAsDateOnly(now);
  const week = homeTimetableWeek(await getSemesters(), today);
  if (!week) return null;
  const slots = await getTimetableSlots(week.semester.id);
  return {
    week,
    table: buildWeekTimetable(slots, week.semester.startDate, week.week, today),
    empty: slots.length === 0,
  };
}
