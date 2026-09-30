import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WeekTimetableGrid } from "@/components/week-timetable-grid";
import type { BrowseWeek, WeekTimetable } from "@/lib/timetable";
import { cn } from "@/lib/utils";

/**
 * 翻周视图：首页「本周课表」点「全部周次」落到的地方。
 *
 * 下面那张条目表是**整学期的口径**（「10-13周」这类原文），回答的是
 * 「这学期一共排了什么」；这里回答的是「第 N 周那几天几点在哪间教室」——
 * 后者才是从首页点进来的人要的，所以它在页面最上面，网格和首页那张卡
 * 一模一样（components/week-timetable-grid.tsx），翻周只是换了个周次。
 *
 * 纯链接，不带客户端状态：周次在 URL 上（`?semester=…&week=N`），
 * 能收藏、能后退，导入完 revalidate 也停在原来那一周。
 */
export function TimetableWeekBrowser({
  semesterId,
  semesterName,
  table,
  browse,
}: {
  semesterId: string;
  semesterName: string;
  table: WeekTimetable;
  browse: BrowseWeek;
}) {
  const { week, maxWeek, currentWeek } = browse;
  const href = (target: number) => `/settings/timetable?semester=${semesterId}&week=${target}`;
  const first = table.days[0];
  const last = table.days[table.days.length - 1];
  const weeks = Array.from({ length: maxWeek }, (_, index) => index + 1);

  return (
    <section className="surface space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">第 {week} 教学周</h2>
        {first && last ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {first.dateText} – {last.dateText}
          </span>
        ) : null}
        {week === currentWeek ? (
          <span className="rounded-full bg-well px-2 py-0.5 text-[11px]">本周</span>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">
          {table.busyHalfDays > 0 ? `${table.busyHalfDays} 个半天有课` : "这周没课"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {currentWeek != null && week !== currentWeek ? (
            <Link
              href={href(currentWeek)}
              className="rounded-full bg-well px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              回到本周
            </Link>
          ) : null}
          <StepLink
            href={href(week - 1)}
            disabled={week <= 1}
            label="上一周"
            icon={ChevronLeft}
          />
          <StepLink
            href={href(week + 1)}
            disabled={week >= maxWeek}
            label="下一周"
            icon={ChevronRight}
          />
        </div>
      </div>

      {/* 周次胶囊：未选中走 well 无阴影，选中才是主色实心（视觉语言）。
          今天所在的那一周即使没被选中也带一圈细描边，翻远了还找得回来 */}
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
        <span className="shrink-0 pr-1 text-[11px] text-muted-foreground">教学周</span>
        {weeks.map((item) => (
          <Link
            key={item}
            href={href(item)}
            aria-current={item === week ? "page" : undefined}
            aria-label={`第 ${item} 教学周`}
            className={cn(
              "inline-flex min-w-8 shrink-0 items-center justify-center rounded-full px-2 py-1 text-xs tabular-nums transition-colors",
              item === week
                ? "bg-primary text-primary-foreground"
                : "bg-well text-muted-foreground hover:text-foreground",
              item !== week && item === currentWeek && "inset-ring inset-ring-foreground/20 text-foreground",
            )}
          >
            {item}
          </Link>
        ))}
      </div>

      <WeekTimetableGrid table={table} />

      <p className="text-xs text-muted-foreground">
        {semesterName} · 上课地点照教务系统导出的原文显示，调课了重新导一次。
      </p>
    </section>
  );
}

/** 上一周 / 下一周。到头了画成同样大小的灰块，不是消失——按钮一会儿在一会儿不在，
 *  旁边那个会跟着左右跳 */
function StepLink({
  href,
  disabled,
  label,
  icon: Icon,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: typeof ChevronLeft;
}) {
  const shape = "inline-flex size-8 items-center justify-center rounded-full bg-well";
  if (disabled) {
    return (
      <span className={cn(shape, "text-muted-foreground/60")} aria-hidden>
        <Icon className="size-4" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(shape, "text-muted-foreground transition-colors hover:text-foreground")}
    >
      <Icon className="size-4" aria-hidden />
    </Link>
  );
}
