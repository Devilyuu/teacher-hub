import "dotenv/config";

import { readFile } from "node:fs/promises";
import { prisma } from "../lib/db";
import { dateOnly } from "../lib/date";
import { readTimetableGrid } from "../lib/import/timetable-xls";
import { getTimetableSlots } from "../lib/queries/timetable";
import {
  buildWeekTimetable,
  HALF_DAY_LABELS,
  homeTimetableWeek,
  parseTimetableGrid,
  teachingPosition,
} from "../lib/timetable";

/**
 * 课表的真实数据库验证：解析真实导出文件 → 建临时学期 → 整表写入 →
 * 用首页同一套查询裁出某一周 → 月历口径反推 → 删学期看条目是否级联消失。
 *
 * 不经过 Server Action（它读请求里的会话 cookie，脚本里没有），
 * 验的是 schema、查询和 lib/timetable.ts 的口径能不能在真库上跑通。
 * 用随机名的临时学期，不碰用户真实的「2026-2027-1」。
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const bytes = new Uint8Array(await readFile(new URL("../test/fixtures/timetable-2026-2027-1.xls", import.meta.url)));
  const parsed = parseTimetableGrid(readTimetableGrid(bytes));
  assert(parsed.semester.startDate === "2026-09-14", "开学日没解析出来");
  assert(parsed.skipped.length === 0, "有条目被跳过");

  const name = `verify-timetable-${crypto.randomUUID().slice(0, 8)}`;
  const semester = await prisma.semester.create({
    data: { name, startDate: dateOnly(2026, 9, 14) },
  });
  console.log(`临时学期 ${name} 已建`);

  try {
    await prisma.timetableSlot.createMany({
      data: parsed.slots.map((slot) => ({ ...slot, semesterId: semester.id })),
    });
    const slots = await getTimetableSlots(semester.id);
    assert(slots.length === parsed.slots.length, `写入 ${parsed.slots.length} 条，读回 ${slots.length} 条`);
    console.log(`写入并读回 ${slots.length} 条`);

    // 第 10 周（11 月 16 日那周）：周一上午有「创意编程基础」
    const week10 = buildWeekTimetable(slots, semester.startDate, 10, dateOnly(2026, 11, 18));
    const monday = week10.days[0]!;
    assert(monday.dateText === "11/16", `第 10 周周一应是 11/16，得到 ${monday.dateText}`);
    assert(
      monday.cells.AM.some((entry) => entry.courseName === "创意编程基础"),
      "第 10 周周一上午应有创意编程基础",
    );
    assert(week10.days[2]!.isToday, "11/18 应是周三、标成今天");
    for (const day of week10.days) {
      const line = week10.halfDays
        .map((halfDay) => {
          const entries = day.cells[halfDay];
          return `${HALF_DAY_LABELS[halfDay]} ${entries.length ? entries.map((e) => e.courseName).join("+") : "—"}`;
        })
        .join(" | ");
      console.log(`  第10周 ${day.label} ${day.dateText}${day.isToday ? "（今天）" : ""}: ${line}`);
    }
    console.log(`  本周 ${week10.busyHalfDays} 个半天有课`);

    // 首页口径：9/12 提前显示第 1 周；9/23 是第 2 周
    const list = [{ id: semester.id, name, startDate: semester.startDate }];
    assert(homeTimetableWeek(list, dateOnly(2026, 9, 12))?.week === 1, "9/12 应提前显示第 1 周");
    assert(homeTimetableWeek(list, dateOnly(2026, 9, 23))?.week === 2, "9/23 应是第 2 周");

    // 月历口径：2026-11-20 是第 10 周周五，这天周五的条目里有 10-13 周的那门
    const position = teachingPosition(semester.startDate, dateOnly(2026, 11, 20));
    assert(position?.week === 10 && position.weekday === 5, "11/20 应是第 10 周周五");
    const friday = slots.filter((slot) => slot.weekday === 5 && slot.weeks.includes(10));
    assert(friday.length > 0, "第 10 周周五应有课");
    console.log(`月历反推：11/20 = 第 ${position.week} 周周${position.weekday}，${friday.length} 条覆盖`);
  } finally {
    await prisma.semester.delete({ where: { id: semester.id } });
    const remaining = await prisma.timetableSlot.count({ where: { semesterId: semester.id } });
    assert(remaining === 0, `删学期后仍有 ${remaining} 条课表没级联删除`);
    console.log("临时学期已删，课表条目级联清空");
  }

  console.log("verify:timetable 通过");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
