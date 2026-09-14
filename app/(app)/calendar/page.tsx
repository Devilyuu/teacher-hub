import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildMonthGrid,
  formatMonthParam,
  monthRange,
  parseMonthParam,
  shiftMonth,
  type CalendarEvent,
} from "@/lib/calendar";
import { formatDateOnly } from "@/lib/date";
import { entryTitle } from "@/lib/competitions";
import { prisma } from "@/lib/db";
import { HALF_DAY_LABELS, halfDayOf, MAX_TEACHING_WEEKS_MS, teachingPosition } from "@/lib/timetable";
import { cn } from "@/lib/utils";

import { RoutineTabs } from "@/components/routine-tabs";
import { getEnabledModules } from "@/lib/module-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "日历" };

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 四种来源三档中性 + 课题截止日一档琥珀。琥珀取自健康度语义板
    （--h-amber）而不是装饰色板：截止日本来就是紧急度提示，用装饰色会让它
    看起来只是个分类标签。其余四种一律中性——它们是**来源分类**（正交维度），
    各上一个颜色的话一屏会出现五种色，谁也看不出哪条要紧 */
const KIND_STYLE: Record<CalendarEvent["kind"], string> = {
  meeting: "bg-foreground/10 text-foreground",
  classSession: "bg-foreground/5 text-foreground/80",
  duty: "bg-muted text-muted-foreground",
  projectDeadline: "bg-[var(--h-amber-bg)] text-[var(--h-amber-fg)]",
  taskDue: "bg-muted text-muted-foreground",
  // 报名截止和结题截止同属「错过就没了」，共用琥珀档；
  // 这是唯一被允许借健康度语义色的一类——它表达的正是紧迫，不是分类
  competition: "bg-[var(--h-amber-bg)] text-[var(--h-amber-fg)]",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const monthParam = typeof params.m === "string" ? params.m : null;
  const [year, month] = parseMonthParam(monthParam);
  const { from, to } = monthRange(year, month);

  // 前后各多取一周，补齐格上的事件也要显示
  const wide = { gte: new Date(from.getTime() - 7 * 86_400_000), lte: new Date(to.getTime() + 7 * 86_400_000) };

  const modules = await getEnabledModules();

  const [meetings, duties, projects, tasks, semesters, competitionEntries] = await Promise.all([
    prisma.meeting.findMany({
      where: { meetingTime: wide },
      select: { id: true, title: true, meetingTime: true },
    }),
    // 轮派模块关了，月历上也不该出现它的条目——「导航上没有、日历里却有」是裂缝
    modules.duties
      ? prisma.dutyRecord.findMany({
          where: { date: wide },
          select: {
            id: true,
            title: true,
            date: true,
            dutyType: { select: { name: true } },
            participants: { select: { teacher: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    // **合并后才有的东西**：课题的结题与申报截止日铺到同一张月历上
    prisma.project.findMany({
      where: {
        archivedAt: null,
        OR: [{ closingDeadline: wide }, { applyDeadline: wide }],
      },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        closingDeadline: true,
        applyDeadline: true,
      },
    }),
    prisma.task.findMany({
      where: { dueDate: wide, deletedAt: null, status: { not: "DONE" } },
      select: { id: true, title: true, dueDate: true },
    }),
    // 和这个月有交集的学期连课表一起取：开学日在月末之前、且开学日 + 量程在月初之后
    prisma.semester.findMany({
      where: {
        startDate: { lte: wide.lte, gte: new Date(wide.gte.getTime() - MAX_TEACHING_WEEKS_MS) },
      },
      select: { id: true, startDate: true, timetable: true },
    }),
    // 参赛模块关了，月历上也不该出现它的条目——同轮派那条裂缝
    modules.competitions
      ? prisma.competitionEntry.findMany({
          where: {
            status: { not: "WITHDRAWN" },
            OR: [{ registerDeadline: wide }, { competeAt: wide }],
          },
          select: {
            id: true,
            year: true,
            track: true,
            level: true,
            status: true,
            award: true,
            registerDeadline: true,
            competeAt: true,
            competition: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const events: CalendarEvent[] = [];

  // 上课不是存的事件，是课表 × 教学周推出来的：逐天问「这天是第几周星期几」，
  // 再看哪些条目覆盖这一周。口径只在 lib/timetable.ts 一处
  for (const semester of semesters) {
    if (semester.timetable.length === 0) continue;
    for (let t = wide.gte.getTime(); t <= wide.lte.getTime(); t += 86_400_000) {
      const day = new Date(t);
      const position = teachingPosition(semester.startDate, day);
      if (!position) continue;
      for (const slot of semester.timetable) {
        if (slot.weekday !== position.weekday || !slot.weeks.includes(position.week)) continue;
        events.push({
          id: `c-${slot.id}-${formatDateOnly(day)}`,
          kind: "classSession",
          title: `${HALF_DAY_LABELS[halfDayOf(slot.periodStart)]}·${slot.courseName}`,
          date: formatDateOnly(day),
          href: "/settings/timetable",
          note: [slot.className, slot.location].filter(Boolean).join(" · ") || undefined,
        });
      }
    }
  }

  for (const meeting of meetings) {
    const pad = (n: number) => String(n).padStart(2, "0");
    events.push({
      id: `m-${meeting.id}`,
      kind: "meeting",
      title: meeting.title,
      date: `${meeting.meetingTime.getFullYear()}-${pad(meeting.meetingTime.getMonth() + 1)}-${pad(meeting.meetingTime.getDate())}`,
      time: `${pad(meeting.meetingTime.getHours())}:${pad(meeting.meetingTime.getMinutes())}`,
      href: `/meetings/${meeting.id}`,
    });
  }

  for (const duty of duties) {
    events.push({
      id: `d-${duty.id}`,
      kind: "duty",
      title: `${duty.dutyType.name}·${duty.title}`,
      date: formatDateOnly(duty.date),
      href: "/duties",
      note: duty.participants.map((row) => row.teacher.name).join("、"),
    });
  }

  for (const project of projects) {
    const name = project.shortTitle ?? project.title;
    if (project.closingDeadline) {
      events.push({
        id: `pc-${project.id}`,
        kind: "projectDeadline",
        title: `结题截止·${name}`,
        date: formatDateOnly(project.closingDeadline),
        href: `/projects/${project.id}`,
      });
    }
    if (project.applyDeadline) {
      events.push({
        id: `pa-${project.id}`,
        kind: "projectDeadline",
        title: `申报截止·${name}`,
        date: formatDateOnly(project.applyDeadline),
        href: `/projects/${project.id}`,
      });
    }
  }

  // 报名截止和比赛日期各是一条。**不在这里判断「过没过期」**——
  // 月历是查历史也查将来的，翻回上个月本来就该看见那天的报名截止
  for (const entry of competitionEntries) {
    const name = entryTitle({
      year: entry.year,
      competitionName: entry.competition.name,
      track: entry.track,
      level: entry.level,
    });
    if (entry.registerDeadline && entry.award == null) {
      events.push({
        id: `cr-${entry.id}`,
        kind: "competition",
        title: `报名截止·${name}`,
        date: formatDateOnly(entry.registerDeadline),
        href: `/competitions/${entry.id}`,
      });
    }
    if (entry.competeAt) {
      events.push({
        id: `cc-${entry.id}`,
        kind: "competition",
        title: `比赛·${name}`,
        date: formatDateOnly(entry.competeAt),
        href: `/competitions/${entry.id}`,
      });
    }
  }

  for (const task of tasks) {
    if (!task.dueDate) continue;
    events.push({
      id: `t-${task.id}`,
      kind: "taskDue",
      title: task.title,
      date: formatDateOnly(task.dueDate),
      href: "/tasks",
    });
  }

  const cells = buildMonthGrid(year, month, events);
  const [prevYear, prevMonth] = shiftMonth(year, month, -1);
  const [nextYear, nextMonth] = shiftMonth(year, month, 1);

  return (
    <div className="space-y-6">
      <RoutineTabs modules={modules} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">日历</h1>
          <p className="measure text-muted-foreground">
            上课、会议、轮派、课题截止日、任务到期，铺在同一张月历上。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/calendar?m=${formatMonthParam(prevYear, prevMonth)}`}
            aria-label="上个月"
            className="inline-flex size-9 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
            style={{ boxShadow: "var(--shadow-pill)" }}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="min-w-[6rem] text-center text-sm font-medium tabular-nums">
            {year} 年 {month} 月
          </span>
          <Link
            href={`/calendar?m=${formatMonthParam(nextYear, nextMonth)}`}
            aria-label="下个月"
            className="inline-flex size-9 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
            style={{ boxShadow: "var(--shadow-pill)" }}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      <div className="surface overflow-x-auto p-3">
        <div className="grid min-w-[52rem] grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => (
            <div key={day} className="pb-1 text-center text-xs text-muted-foreground">
              {day}
            </div>
          ))}

          {cells.map((cell) => (
            <div
              key={cell.date}
              className={cn(
                "min-h-24 rounded-lg p-1.5",
                cell.inMonth ? "bg-muted/30" : "bg-transparent",
                cell.isToday && "inset-ring inset-ring-foreground/20",
              )}
            >
              <div
                className={cn(
                  "mb-1 text-xs tabular-nums",
                  cell.isToday
                    ? "font-medium text-foreground"
                    : cell.inMonth
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40",
                )}
              >
                {cell.day}
              </div>

              <ul className="space-y-1">
                {cell.events.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      title={item.note ? `${item.title}（${item.note}）` : item.title}
                      className={cn(
                        "block truncate rounded px-1.5 py-0.5 text-xs",
                        KIND_STYLE[item.kind],
                      )}
                    >
                      {item.time ? `${item.time} ` : ""}
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-foreground/10" /> 会议
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-foreground/5" /> 上课
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted" /> 轮派 / 任务
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--h-amber-bg)]" /> 课题截止日
        </span>
      </div>
    </div>
  );
}
