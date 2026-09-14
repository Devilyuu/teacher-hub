import "server-only";
import { prisma } from "@/lib/db";
import { agendaTarget, buildDayAgenda, type DayAgenda } from "@/lib/day-agenda";
import { semesterStatus, type SemesterLike } from "@/lib/semester";
import { getTimetableSlots } from "@/lib/queries/timetable";

/**
 * 首页问候带那一行要的数据。口径全在 lib/day-agenda.ts，这里只取数。
 * 学期由调用方传入：问候行本来就要查一遍学期算教学周，不再重复查
 */
export async function getDayAgenda(
  now: Date,
  semesters: Array<SemesterLike & { id: string }>,
): Promise<DayAgenda> {
  const target = agendaTarget(now);

  // 会议是带时刻的时间戳，日界按本地时区取（进程时区 = 用户时区，部署铁律）
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  if (target.isTomorrow) dayStart.setDate(dayStart.getDate() + 1);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const status = semesterStatus(semesters, target.date);
  const semester = status?.kind === "week" ? semesters.find((item) => item.name === status.name) : undefined;

  const [meetings, slots] = await Promise.all([
    prisma.meeting.findMany({
      where: { meetingTime: { gte: dayStart, lt: dayEnd } },
      select: { id: true, title: true, meetingTime: true },
      orderBy: { meetingTime: "asc" },
    }),
    semester ? getTimetableSlots(semester.id) : Promise.resolve([]),
  ]);

  return buildDayAgenda({ target, semesters, slots, meetings });
}
