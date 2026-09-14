import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import { readTimetableGrid } from "@/lib/import/timetable-xls";
import {
  buildWeekTimetable,
  dateOfTeachingDay,
  formatClassName,
  halfDayOf,
  homeTimetableWeek,
  mergeAdjacentPeriods,
  parseTimetableGrid,
  parseWeeksText,
  teachingPosition,
  type ParsedSlot,
} from "@/lib/timetable";

/**
 * 按教务系统真实导出文件（2026-2027-1）的结构合成：表头、合并单元格、条目字段顺序、
 * 表尾说明都照原样，姓名、学院、校区、班级、课程换成了虚构的。格式一变，这组测试先红
 */
const FIXTURE = new URL("../test/fixtures/timetable-2026-2027-1.xls", import.meta.url);

function loadFixture() {
  return parseTimetableGrid(readTimetableGrid(new Uint8Array(readFileSync(FIXTURE))));
}

describe("parseWeeksText", () => {
  it("连续、离散、单条都认", () => {
    expect(parseWeeksText("10-13周")).toEqual([10, 11, 12, 13]);
    expect(parseWeeksText("13周,18-19周")).toEqual([13, 18, 19]);
    expect(parseWeeksText("1-2周,4周")).toEqual([1, 2, 4]);
    expect(parseWeeksText("5周")).toEqual([5]);
  });

  it("单双周按奇偶过滤", () => {
    expect(parseWeeksText("1-6周(单)")).toEqual([1, 3, 5]);
    expect(parseWeeksText("2-6双周")).toEqual([2, 4, 6]);
    expect(parseWeeksText("1-4周（双）")).toEqual([2, 4]);
  });

  it("认不出数字返回空数组", () => {
    expect(parseWeeksText("")).toEqual([]);
    expect(parseWeeksText("待定")).toEqual([]);
  });
});

describe("halfDayOf", () => {
  it("1–4 节上午、5–8 节下午、9 节起晚上", () => {
    expect(halfDayOf(1)).toBe("AM");
    expect(halfDayOf(4)).toBe("AM");
    expect(halfDayOf(5)).toBe("PM");
    expect(halfDayOf(8)).toBe("PM");
    expect(halfDayOf(9)).toBe("EVE");
  });
});

describe("parseTimetableGrid（按真实导出结构合成的文件）", () => {
  it("读出学期信息：名字按设置页习惯、开学日与总周数取自表尾", () => {
    const result = loadFixture();
    expect(result.semester).toEqual({
      name: "2026-2027-1",
      startDate: "2026-09-14",
      endDate: "2027-01-24",
      totalWeeks: 20,
      teacherName: "林知远",
    });
  });

  it("没有一条被跳过", () => {
    expect(loadFixture().skipped).toEqual([]);
  });

  it("同一门课上下两大节合成一条，1-2 节 + 3-4 节 → 1-4 节", () => {
    const { slots } = loadFixture();
    const monday = slots.filter((slot) => slot.weekday === 1);
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatchObject({
      periodStart: 1,
      periodEnd: 4,
      weeks: [10, 11, 12, 13],
      weeksText: "10-13周",
      courseName: "创意编程基础",
      className: "数字媒体2601;数字媒体2602",
      location: "东校区 实训楼309",
    });
    // 原文两行都留着，排查时能看到教务系统到底给了什么
    expect(monday[0]!.rawText.split("\n")).toHaveLength(2);
  });

  it("离散周次「13周,18-19周」展开正确", () => {
    const { slots } = loadFixture();
    const ui = slots.find(
      (slot) => slot.weekday === 2 && slot.courseName === "交互界面设计" && slot.periodStart === 5,
    );
    expect(ui).toMatchObject({ periodEnd: 8, weeks: [13, 18, 19], weeksText: "13周,18-19周" });
  });

  it("整表条目数：周一 1、周二 4、周三 2、周四 3、周五 7", () => {
    const { slots } = loadFixture();
    const byWeekday = [1, 2, 3, 4, 5, 6, 7].map(
      (weekday) => slots.filter((slot) => slot.weekday === weekday).length,
    );
    expect(byWeekday).toEqual([1, 4, 2, 3, 7, 0, 0]);
  });

  it("不是课表就抛错", () => {
    expect(() => parseTimetableGrid([["随便", "什么"], ["表格"]])).toThrow(/星期一/);
  });

  it("条目里没写节次时用行标签的大节兜底", () => {
    const result = parseTimetableGrid([
      ["节次", "", "星期一", "星期二", "星期三", "星期四", "星期五"],
      ["上午", "二", "高数/1-8周/一教101", "", "", "", ""],
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.slots[0]).toMatchObject({
      weekday: 1,
      periodStart: 3,
      periodEnd: 4,
      weeks: [1, 2, 3, 4, 5, 6, 7, 8],
      courseName: "高数",
      className: null,
    });
  });

  it("认不出周次的条目进 skipped 而不是静默丢", () => {
    const result = parseTimetableGrid([
      ["节次", "", "星期一", "星期二", "星期三", "星期四", "星期五"],
      ["上午", "一", "高数/(1-2节)待定/一教101", "", "", "", ""],
    ]);
    expect(result.slots).toEqual([]);
    expect(result.skipped).toEqual([
      { weekday: 1, text: "高数/(1-2节)待定/一教101", reason: "没找到周次" },
    ]);
  });
});

describe("mergeAdjacentPeriods", () => {
  const base: ParsedSlot = {
    weekday: 1,
    periodStart: 3,
    periodEnd: 4,
    weeks: [1],
    weeksText: "1周",
    courseName: "A",
    className: null,
    location: null,
    rawText: "a",
  };

  it("不跨半天：3-4 节和 5-6 节不合并", () => {
    const merged = mergeAdjacentPeriods([base, { ...base, periodStart: 5, periodEnd: 6 }]);
    expect(merged).toHaveLength(2);
  });

  it("周次不同不合并", () => {
    const merged = mergeAdjacentPeriods([
      { ...base, periodStart: 1, periodEnd: 2 },
      { ...base, weeksText: "2周", weeks: [2] },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("教学周与日期", () => {
  const start = dateOnly(2026, 9, 7);

  it("第 1 周周一就是开学日，第 2 周周三是 9/16", () => {
    expect(dateOfTeachingDay(start, 1, 1)).toEqual(start);
    expect(dateOfTeachingDay(start, 2, 3)).toEqual(dateOnly(2026, 9, 16));
  });

  it("反推：9/16 是第 2 周周三；开学前是 null", () => {
    expect(teachingPosition(start, dateOnly(2026, 9, 16))).toEqual({ week: 2, weekday: 3 });
    expect(teachingPosition(start, dateOnly(2026, 9, 6))).toBeNull();
  });
});

describe("homeTimetableWeek", () => {
  const semesters = [{ id: "s1", name: "2026-2027-1", startDate: dateOnly(2026, 9, 7) }];

  it("开学后取当前教学周", () => {
    expect(homeTimetableWeek(semesters, dateOnly(2026, 9, 16))).toMatchObject({
      week: 2,
      upcoming: false,
    });
  });

  it("七天内开学提前显示第 1 周，再早就不显示", () => {
    expect(homeTimetableWeek(semesters, dateOnly(2026, 9, 5))).toMatchObject({
      week: 1,
      upcoming: true,
    });
    expect(homeTimetableWeek(semesters, dateOnly(2026, 8, 20))).toBeNull();
  });

  it("超过量程（假期忘了设新学期）不显示", () => {
    expect(homeTimetableWeek(semesters, dateOnly(2027, 4, 1))).toBeNull();
  });
});

describe("buildWeekTimetable", () => {
  const start = dateOnly(2026, 9, 7);
  const slots = [
    {
      id: "a",
      weekday: 1,
      periodStart: 1,
      periodEnd: 4,
      weeks: [1, 2],
      courseName: "A",
      className: "甲;乙",
      location: "101",
    },
    {
      id: "b",
      weekday: 1,
      periodStart: 5,
      periodEnd: 6,
      weeks: [2],
      courseName: "B",
      className: null,
      location: null,
    },
    {
      id: "c",
      weekday: 3,
      periodStart: 9,
      periodEnd: 10,
      weeks: [5],
      courseName: "晚课",
      className: null,
      location: null,
    },
  ];

  it("按周裁：第 1 周周一只有上午，第 2 周上下午都有", () => {
    const week1 = buildWeekTimetable(slots, start, 1, dateOnly(2026, 9, 7));
    const monday1 = week1.days[0]!;
    expect(monday1.cells.AM.map((entry) => entry.courseName)).toEqual(["A"]);
    expect(monday1.cells.PM).toEqual([]);
    expect(monday1.isToday).toBe(true);
    expect(monday1.dateText).toBe("9/7");
    expect(week1.busyHalfDays).toBe(1);

    const week2 = buildWeekTimetable(slots, start, 2, dateOnly(2026, 9, 7));
    expect(week2.days[0]!.cells.PM.map((entry) => entry.periodText)).toEqual(["5-6节"]);
    expect(week2.busyHalfDays).toBe(2);
  });

  it("列与行按整学期定：有晚课就画晚上那列，周六周日没课就不画", () => {
    const week = buildWeekTimetable(slots, start, 1, dateOnly(2026, 9, 7));
    expect(week.halfDays).toEqual(["AM", "PM", "EVE"]);
    expect(week.days.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5]);

    const noEvening = buildWeekTimetable(slots.slice(0, 2), start, 1, dateOnly(2026, 9, 7));
    expect(noEvening.halfDays).toEqual(["AM", "PM"]);
  });
});

describe("formatClassName", () => {
  it("分号换顿号", () => {
    expect(formatClassName("数字媒体2601;数字媒体2602")).toBe("数字媒体2601、数字媒体2602");
    expect(formatClassName(null)).toBeNull();
  });
});
