import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  daysFromToday,
  formatMonthParam,
  monthRange,
  parseMonthParam,
  shiftMonth,
  sortEvents,
  type CalendarEvent,
} from "./calendar";

const NOW = new Date(2026, 6, 28, 9, 0); // 2026-07-28 周二

function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    kind: "meeting",
    title: "系部例会",
    date: "2026-07-08",
    href: "/meetings/e1",
    ...over,
  };
}

describe("monthRange", () => {
  it("给出当月第一天与最后一天", () => {
    const { from, to } = monthRange(2026, 7);
    expect(from.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(to.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("2 月按闰年算", () => {
    expect(monthRange(2024, 2).to.toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(monthRange(2026, 2).to.toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

/** 月历缺了首尾的补齐格会错位，而错位的日历没人看得懂 */
describe("buildMonthGrid", () => {
  it("补满整周，格子数是 7 的倍数", () => {
    const cells = buildMonthGrid(2026, 7, [], NOW);
    expect(cells.length % 7).toBe(0);
  });

  it("按周一起头", () => {
    // 2026-07-01 是周三，所以前面要补周一、周二两格（6-29、6-30）
    const cells = buildMonthGrid(2026, 7, [], NOW);
    expect(cells[0].date).toBe("2026-06-29");
    expect(cells[0].inMonth).toBe(false);
    expect(cells[2].date).toBe("2026-07-01");
    expect(cells[2].inMonth).toBe(true);
  });

  it("标出今天", () => {
    const cells = buildMonthGrid(2026, 7, [], NOW);
    const today = cells.filter((cell) => cell.isToday);
    expect(today).toHaveLength(1);
    expect(today[0].date).toBe("2026-07-28");
  });

  it("事件落到对应格子里", () => {
    const cells = buildMonthGrid(2026, 7, [event({ date: "2026-07-08" })], NOW);
    const cell = cells.find((c) => c.date === "2026-07-08");
    expect(cell?.events).toHaveLength(1);
    expect(cells.filter((c) => c.events.length > 0)).toHaveLength(1);
  });

  it("落在补齐格上的事件也显示——那几天确实在这一屏里", () => {
    const cells = buildMonthGrid(2026, 7, [event({ date: "2026-06-30" })], NOW);
    const cell = cells.find((c) => c.date === "2026-06-30");
    expect(cell?.inMonth).toBe(false);
    expect(cell?.events).toHaveLength(1);
  });
});

describe("sortEvents", () => {
  it("会议排在值班和截止日前面", () => {
    const rows = sortEvents([
      event({ id: "d", kind: "duty", title: "监考" }),
      event({ id: "p", kind: "projectDeadline", title: "结题" }),
      event({ id: "m", kind: "meeting", title: "例会" }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["meeting", "duty", "projectDeadline"]);
  });

  it("同为会议时按时刻排", () => {
    const rows = sortEvents([
      event({ id: "b", time: "14:30" }),
      event({ id: "a", time: "09:00" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("shiftMonth", () => {
  it("跨年进位", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual([2027, 1]);
    expect(shiftMonth(2026, 1, -1)).toEqual([2025, 12]);
  });

  it("月内平移", () => {
    expect(shiftMonth(2026, 7, 1)).toEqual([2026, 8]);
    expect(shiftMonth(2026, 7, -1)).toEqual([2026, 6]);
  });
});

describe("parseMonthParam", () => {
  it("解析 YYYY-MM", () => {
    expect(parseMonthParam("2026-09", NOW)).toEqual([2026, 9]);
  });

  it("坏值退回当月", () => {
    expect(parseMonthParam(null, NOW)).toEqual([2026, 7]);
    expect(parseMonthParam("2026-13", NOW)).toEqual([2026, 7]);
    expect(parseMonthParam("乱填", NOW)).toEqual([2026, 7]);
  });

  it("与 formatMonthParam 互逆", () => {
    expect(formatMonthParam(...parseMonthParam("2026-09", NOW))).toBe("2026-09");
  });
});

describe("daysFromToday", () => {
  it("未来为正、过去为负", () => {
    expect(daysFromToday("2026-07-30", NOW)).toBe(2);
    expect(daysFromToday("2026-07-28", NOW)).toBe(0);
    expect(daysFromToday("2026-07-20", NOW)).toBe(-8);
  });
});
