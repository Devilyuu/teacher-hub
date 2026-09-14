import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { ClearCalendarArt } from "@/components/empty-art";
import { SideCard } from "@/components/home-side";
import type { HomeTimetable } from "@/lib/queries/timetable";
import {
  formatClassName,
  HALF_DAY_LABELS,
  type HalfDay,
  type WeekTimetableDay,
  type WeekTimetableEntry,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";

/**
 * 首页的「本周课表」，放左栏「今天要处理」等队列的下面。
 *
 * 这张卡回答的问题只有一个：**这周哪几个半天走不开**。所以粒度是半天，
 * 不是教务系统那种「节次 × 星期」的大表。
 *
 * **两种排法，按宽度切**：
 * - `sm` 以上横排：周几是列、上午/下午是行，三行就画完，左栏 830px 分五列
 *   每格 150px，课程名整行放得下。它原来在右栏竖排（周几是行），
 *   把右栏拉到左栏的三倍高，左栏下面空出一大片
 * - 手机竖排：周几是行、半天是列。390px 分五列每格 65px，课程名放不下
 *
 * 每个半天是一块 well 槽位，没课的槽留空但槽还在——画「—」的话一周只有一节课时
 * 整张卡是十个破折号，看起来像坏了。今天用小圆点加细描边标出，不上色
 * （健康度那六个语义色不许碰）。数据由 lib/queries/timetable.ts 算好，这里只画。
 */
export function WeekTimetable({ data }: { data: HomeTimetable }) {
  const { week, table, empty } = data;
  const heading = week.upcoming
    ? `${week.semester.startDate.getUTCMonth() + 1} 月 ${week.semester.startDate.getUTCDate()} 日开学 · 第 1 教学周`
    : `第 ${week.week} 教学周`;

  return (
    <SideCard title="本周课表" icon={CalendarRange} domain="teaching" actionHref="/settings/timetable" actionLabel="课表">
      {empty ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-well px-4 py-5 text-center">
          <ClearCalendarArt className="size-11 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">
            {week.semester.name} 还没有课表
          </p>
          <Link
            href="/settings/timetable"
            className="text-xs underline-offset-4 hover:underline"
          >
            上传教务系统导出的课表 →
          </Link>
        </div>
      ) : (
        <>
          <p className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{heading}</span>
            <span className="tabular-nums">
              {table.busyHalfDays > 0 ? `${table.busyHalfDays} 个半天有课` : "本周没课"}
            </span>
          </p>

          {/* 横排：列是周几 */}
          <div
            className="hidden gap-1 text-xs sm:grid"
            style={{
              gridTemplateColumns: `2.5rem repeat(${table.days.length}, minmax(0, 1fr))`,
            }}
          >
            <span aria-hidden />
            {table.days.map((day) => (
              <DayLabel key={day.weekday} day={day} className="px-2" />
            ))}
            {table.halfDays.map((halfDay) => (
              <div key={halfDay} className="contents">
                <span className="flex items-center text-[11px] text-muted-foreground">
                  {HALF_DAY_LABELS[halfDay]}
                </span>
                {table.days.map((day) => (
                  <Slot key={day.weekday} entries={day.cells[halfDay]} today={day.isToday} />
                ))}
              </div>
            ))}
          </div>

          {/* 竖排：行是周几 */}
          <div
            className="grid gap-1 text-xs sm:hidden"
            style={{
              gridTemplateColumns: `3.75rem repeat(${table.halfDays.length}, minmax(0, 1fr))`,
            }}
          >
            <span aria-hidden />
            {table.halfDays.map((halfDay) => (
              <span key={halfDay} className="px-2 text-[11px] text-muted-foreground">
                {HALF_DAY_LABELS[halfDay]}
              </span>
            ))}
            {table.days.map((day) => (
              <div key={day.weekday} className="contents">
                <DayLabel day={day} className="pl-1" />
                {table.halfDays.map((halfDay: HalfDay) => (
                  <Slot key={halfDay} entries={day.cells[halfDay]} today={day.isToday} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </SideCard>
  );
}

function DayLabel({ day, className }: { day: WeekTimetableDay; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 leading-none whitespace-nowrap",
        day.isToday ? "font-medium" : "text-muted-foreground",
        className,
      )}
    >
      {day.isToday ? (
        <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
      ) : null}
      <span>{day.label}</span>
      <span className="text-[10px] tabular-nums opacity-70">{day.dateText}</span>
    </span>
  );
}

/** 一个半天。空槽也占位，读得出「这个半天空着」 */
function Slot({ entries, today }: { entries: WeekTimetableEntry[]; today: boolean }) {
  const busy = entries.length > 0;
  return (
    <div
      className={cn(
        "min-h-9 min-w-0 space-y-1 rounded-lg px-2 py-1.5",
        busy ? "bg-well" : "bg-well/40",
        today && "inset-ring inset-ring-foreground/15",
      )}
      aria-label={busy ? undefined : "没课"}
    >
      {entries.map((entry) => {
        const className = formatClassName(entry.className);
        const detail = [entry.periodText, className, entry.location].filter(Boolean).join(" · ");
        return (
          <div key={entry.id} className="min-w-0" title={`${entry.courseName} · ${detail}`}>
            <p className="truncate font-medium">{entry.courseName}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {className ?? entry.periodText}
            </p>
          </div>
        );
      })}
    </div>
  );
}
