import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  MAX_TEACHING_WEEKS,
  semesterStatus,
  teachingWeek,
} from "@/lib/semester";

describe("teachingWeek", () => {
  it("开学日当天是第 1 周，第 6 天还是第 1 周，第 7 天进第 2 周", () => {
    const start = dateOnly(2026, 9, 7);
    expect(teachingWeek(start, dateOnly(2026, 9, 7))).toBe(1);
    expect(teachingWeek(start, dateOnly(2026, 9, 13))).toBe(1);
    expect(teachingWeek(start, dateOnly(2026, 9, 14))).toBe(2);
  });

  it("开学前返回 null", () => {
    expect(
      teachingWeek(dateOnly(2026, 9, 7), dateOnly(2026, 8, 30)),
    ).toBeNull();
  });

  it("超出量程返回 null——假期里忘了设新学期时宁可不报", () => {
    const start = dateOnly(2026, 3, 2);
    const lastDayInRange = dateOnly(2026, 3, 2 + MAX_TEACHING_WEEKS * 7 - 1);
    expect(teachingWeek(start, lastDayInRange)).toBe(MAX_TEACHING_WEEKS);
    expect(teachingWeek(start, dateOnly(2026, 8, 30))).toBeNull();
  });
});

describe("semesterStatus", () => {
  const spring = { name: "2025-2026-2", startDate: dateOnly(2026, 3, 2) };
  const autumn = { name: "2026-2027-1", startDate: dateOnly(2026, 9, 7) };

  it("学期中报周次", () => {
    expect(semesterStatus([spring, autumn], dateOnly(2026, 3, 9))).toEqual({
      kind: "week",
      name: "2025-2026-2",
      week: 2,
    });
  });

  it("假期里上学期超量程，落到下学期的「开学」提示", () => {
    expect(semesterStatus([spring, autumn], dateOnly(2026, 8, 30))).toEqual({
      kind: "upcoming",
      name: "2026-2027-1",
      startDate: dateOnly(2026, 9, 7),
    });
  });

  it("多个已开学的学期取开学日最晚的那个", () => {
    expect(semesterStatus([spring, autumn], dateOnly(2026, 9, 7))).toEqual({
      kind: "week",
      name: "2026-2027-1",
      week: 1,
    });
  });

  it("什么都没设时返回 null", () => {
    expect(semesterStatus([], dateOnly(2026, 8, 30))).toBeNull();
  });
});
