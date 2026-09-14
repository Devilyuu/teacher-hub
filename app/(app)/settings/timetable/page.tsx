import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { getTimetableSlots } from "@/lib/queries/timetable";
import { homeTimetableWeek } from "@/lib/timetable";
import { TimetablePanel, type TimetableSemesterRow, type TimetableSlotRow } from "./timetable-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "课表" };

/**
 * 设置 → 课表。导入教务系统导出的 .xls、看某学期的条目、手工补一条。
 *
 * 单独成页而不是塞进设置页：设置页已经有档案、学期、模块、外部系统、备份五段，
 * 课表的预览表一展开就把它们全挤到屏幕外了。
 */
export default async function TimetableSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const semesters = await prisma.semester.findMany({
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, startDate: true, _count: { select: { timetable: true } } },
  });

  // 默认选首页正在显示的那个学期；假期里没有就选最新的
  const requested = typeof params.semester === "string" ? params.semester : null;
  const homeWeek = homeTimetableWeek(semesters, todayAsDateOnly());
  const selected =
    semesters.find((semester) => semester.id === requested) ??
    semesters.find((semester) => semester.id === homeWeek?.semester.id) ??
    semesters[0] ??
    null;

  const slots = selected ? await getTimetableSlots(selected.id) : [];

  const semesterRows: TimetableSemesterRow[] = semesters.map((semester) => ({
    id: semester.id,
    name: semester.name,
    startText: formatDateOnly(semester.startDate),
    count: semester._count.timetable,
  }));
  const slotRows: TimetableSlotRow[] = slots.map((slot) => ({
    id: slot.id,
    weekday: slot.weekday,
    periodStart: slot.periodStart,
    periodEnd: slot.periodEnd,
    weeksText: slot.weeksText,
    courseName: slot.courseName,
    className: slot.className,
    location: slot.location,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          设置
        </Link>
        <h1 className="page-title">课表</h1>
        <p className="measure text-muted-foreground">
          把教务系统导出的课表传上来，首页就会显示本周哪几个半天有课，月历上也会铺上上课的日子。
          <span className="text-foreground">导入按学期整表覆盖</span>
          ，调课了重新导一次即可；临时改一两节也可以在下面手工补。
        </p>
      </header>

      <TimetablePanel
        semesters={semesterRows}
        selectedId={selected?.id ?? null}
        slots={slotRows}
      />
    </div>
  );
}
