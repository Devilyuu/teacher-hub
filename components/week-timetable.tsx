import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { ClearCalendarArt } from "@/components/empty-art";
import { SideCard } from "@/components/home-side";
import { WeekTimetableGrid } from "@/components/week-timetable-grid";
import type { HomeTimetable } from "@/lib/queries/timetable";

/**
 * 首页的「本周课表」，放左栏「今天要处理」等队列的下面。
 *
 * 这张卡回答的问题只有一个：**这周哪几个半天走不开**。所以粒度是半天，
 * 不是教务系统那种「节次 × 星期」的大表。网格本身在
 * components/week-timetable-grid.tsx，和设置页的翻周视图是同一份。
 *
 * 右上角的入口写「全部周次」而不是「课表」：从这张卡点出去的人要的是
 * 「再往后几周什么样」，落到一个导入表单上等于答非所问。
 */
export function WeekTimetable({ data }: { data: HomeTimetable }) {
  const { week, table, empty } = data;
  const heading = week.upcoming
    ? `${week.semester.startDate.getUTCMonth() + 1} 月 ${week.semester.startDate.getUTCDate()} 日开学 · 第 1 教学周`
    : `第 ${week.week} 教学周`;

  return (
    <SideCard
      title="本周课表"
      icon={CalendarRange}
      domain="teaching"
      actionHref="/settings/timetable"
      actionLabel="全部周次"
    >
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

          <WeekTimetableGrid table={table} />
        </>
      )}
    </SideCard>
  );
}
