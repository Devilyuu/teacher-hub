import { MapPin } from "lucide-react";
import {
  formatClassName,
  HALF_DAY_LABELS,
  type HalfDay,
  type WeekTimetable,
  type WeekTimetableDay,
  type WeekTimetableEntry,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";

/**
 * 一周课表的网格。首页那张「本周课表」（components/week-timetable.tsx）和
 * 设置页的翻周视图共用这一份——两处各画一遍，早晚出现「首页写着实训楼309、
 * 翻到下周却没有地点」这种谁也发现不了的裂缝。
 *
 * **两种排法，按宽度切**：
 * - `sm` 以上横排：周几是列、上午/下午是行，三行就画完
 * - 手机竖排：周几是行、半天是列。390px 分五列每格 65px，课程名放不下
 *
 * 每个半天是一块 well 槽位，没课的槽留空但槽还在——画「—」的话一周只有一节课时
 * 整张卡是十个破折号，看起来像坏了。今天用小圆点加细描边标出，不上色
 * （健康度那六个语义色不许碰）。数据由 lib/timetable.ts 的 buildWeekTimetable
 * 算好，这里只画。
 */
export function WeekTimetableGrid({ table }: { table: WeekTimetable }) {
  return (
    <>
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
      <span className="text-[10px] tabular-nums">{day.dateText}</span>
    </span>
  );
}

/** 一个半天。空槽也占位，读得出「这个半天空着」 */
function Slot({ entries, today }: { entries: WeekTimetableEntry[]; today: boolean }) {
  const busy = entries.length > 0;
  return (
    <div
      className={cn(
        "min-h-14 min-w-0 space-y-2 rounded-lg px-2 py-1.5",
        busy ? "bg-well" : "bg-well/40",
        today && "inset-ring inset-ring-foreground/15",
      )}
      aria-label={busy ? undefined : "没课"}
    >
      {entries.map((entry) => {
        const className = formatClassName(entry.className);
        return (
          <div
            key={entry.id}
            className="min-w-0"
            title={[entry.courseName, entry.periodText, className, entry.location]
              .filter(Boolean)
              .join(" · ")}
          >
            <p className="truncate font-medium">{entry.courseName}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {[entry.periodText, className].filter(Boolean).join(" · ")}
            </p>
            {/* 地点单独一行：上课教室常换，走错楼比迟到还难收场。所以这一行
                不叠淡、不省略成 title——它正是这张卡加高一档换来的东西。
                手工补的条目可能没填地点，那就明说「地点未写」：留空会被读成
                「还是上次那间」，而那是猜不是事实（第 8 条铁律的同一条） */}
            <p className="mt-0.5 flex items-center gap-1 text-[11px]">
              <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className={cn("truncate", entry.location ? undefined : "text-muted-foreground")}>
                {entry.location ?? "地点未写"}
              </span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
