import { describe, expect, it } from "vitest";
import { dateOnly, formatDateOnly } from "@/lib/date";
import {
  agendaTarget,
  buildDayAgenda,
  halfDayOfMeeting,
  type AgendaMeeting,
  type AgendaSlot,
} from "@/lib/day-agenda";

// 2026-2027-1 按 9 月 7 日（周一）开学：9/15 是第 2 周周二、9/13 是第 1 周周日
const SEMESTERS = [{ name: "2026-2027-1", startDate: dateOnly(2026, 9, 7) }];

const SLOTS: AgendaSlot[] = [
  // 周二上午 3-4 节，1-16 周
  { weekday: 2, periodStart: 3, periodEnd: 4, weeks: range(1, 16), courseName: "三维动画设计", location: "实训楼 302" },
  // 周三上午 1-2 节，只有第 3 周起才上
  { weekday: 3, periodStart: 1, periodEnd: 2, weeks: range(3, 16), courseName: "数字媒体概论", location: null },
  // 周三下午 5-6 节
  { weekday: 3, periodStart: 5, periodEnd: 6, weeks: range(1, 16), courseName: "三维动画设计", location: "实训楼 302" },
];

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** 会议时刻一律用本地构造，和线上「进程时区 = 用户时区」的口径一致 */
function meeting(id: string, title: string, y: number, m: number, d: number, h: number, min = 0): AgendaMeeting {
  return { id, title, meetingTime: new Date(y, m - 1, d, h, min) };
}

describe("agendaTarget", () => {
  it("18 点前说今天，18 点起说明天", () => {
    expect(agendaTarget(new Date(2026, 8, 15, 17, 59))).toEqual({ date: dateOnly(2026, 9, 15), isTomorrow: false });
    expect(agendaTarget(new Date(2026, 8, 15, 18, 0))).toEqual({ date: dateOnly(2026, 9, 16), isTomorrow: true });
  });

  it("月底跨到下个月不出错", () => {
    expect(formatDateOnly(agendaTarget(new Date(2026, 8, 30, 20, 0)).date)).toBe("2026-10-01");
  });
});

describe("halfDayOfMeeting", () => {
  it("12 点前上午、18 点前下午、之后晚上", () => {
    expect(halfDayOfMeeting(new Date(2026, 8, 15, 11, 59))).toBe("AM");
    expect(halfDayOfMeeting(new Date(2026, 8, 15, 12, 0))).toBe("PM");
    expect(halfDayOfMeeting(new Date(2026, 8, 15, 17, 30))).toBe("PM");
    expect(halfDayOfMeeting(new Date(2026, 8, 15, 19, 0))).toBe("EVE");
  });
});

describe("buildDayAgenda", () => {
  const tuesday = { date: dateOnly(2026, 9, 15), isTomorrow: false };

  it("课和会按半天排进去；晚上没事就不出现", () => {
    const agenda = buildDayAgenda({
      target: tuesday,
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [meeting("m1", "专业群建设研讨会", 2026, 9, 15, 14)],
    });
    expect(agenda.timetable).toBe("known");
    expect(agenda.lead).toBe("今天");
    expect(agenda.halfDays.map((cell) => [cell.label, cell.entries.map((entry) => entry.text)])).toEqual([
      ["上午", ["3-4节《三维动画设计》· 实训楼 302"]],
      ["下午", ["14:00 专业群建设研讨会"]],
    ]);
    expect(agenda.nextClass).toBeNull();
  });

  it("晚上有会时才多出「晚上」", () => {
    const agenda = buildDayAgenda({
      target: tuesday,
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [meeting("m1", "班会", 2026, 9, 15, 19, 30)],
    });
    expect(agenda.halfDays.map((cell) => cell.label)).toEqual(["上午", "下午", "晚上"]);
    expect(agenda.halfDays[2]?.entries[0]?.text).toBe("19:30 班会");
  });

  it("只取这一周真的在上的课（周次不含本周的不算）", () => {
    const agenda = buildDayAgenda({
      target: { date: dateOnly(2026, 9, 16), isTomorrow: true },
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [],
    });
    expect(agenda.lead).toBe("明天 · 周三");
    // 数字媒体概论第 3 周才开，9/16 是第 2 周
    expect(agenda.halfDays.map((cell) => cell.entries.map((entry) => entry.text))).toEqual([
      [],
      ["5-6节《三维动画设计》· 实训楼 302"],
    ]);
  });

  it("不是这一天的会不进来（调用方取宽了也不会串天）", () => {
    const agenda = buildDayAgenda({
      target: tuesday,
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [meeting("m0", "昨天的会", 2026, 9, 14, 23, 30)],
    });
    expect(agenda.halfDays.flatMap((cell) => cell.entries).some((entry) => entry.kind === "meeting")).toBe(false);
  });

  it("没课也没会：往后找到下一节课", () => {
    const agenda = buildDayAgenda({
      target: { date: dateOnly(2026, 9, 13), isTomorrow: false },
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [],
    });
    expect(agenda.halfDays.every((cell) => cell.entries.length === 0)).toBe(true);
    expect(agenda.nextClass).toBe("9/15 周二上午 3-4节《三维动画设计》");
  });

  it("课表没导入时不说「没有课」，只报会", () => {
    const agenda = buildDayAgenda({
      target: tuesday,
      semesters: SEMESTERS,
      slots: [],
      meetings: [meeting("m1", "专业群建设研讨会", 2026, 9, 15, 14)],
    });
    expect(agenda.timetable).toBe("not-imported");
    expect(agenda.halfDays).toEqual([]);
    expect(agenda.meetings.map((entry) => entry.text)).toEqual(["14:00 专业群建设研讨会"]);
  });

  it("一个学期都没设也按没导入处理", () => {
    const agenda = buildDayAgenda({ target: tuesday, semesters: [], slots: [], meetings: [] });
    expect(agenda.timetable).toBe("not-imported");
  });

  it("假期里（有学期但不在教学周）不提课，也不催导入", () => {
    const agenda = buildDayAgenda({
      target: { date: dateOnly(2026, 8, 20), isTomorrow: false },
      semesters: SEMESTERS,
      slots: SLOTS,
      meetings: [],
    });
    expect(agenda.timetable).toBe("out-of-term");
    expect(agenda.halfDays).toEqual([]);
    expect(agenda.nextClass).toBeNull();
  });
});
