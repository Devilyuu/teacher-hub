import { describe, expect, it } from "vitest";
import {
  dateOnly,
  diffInDays,
  formatDateOnly,
  formatYearMonth,
  formatYearOnly,
  todayAsDateOnly,
} from "./date";

describe("dateOnly · 纯日期一律 UTC 午夜", () => {
  it("构造出来就是 UTC 午夜", () => {
    const d = dateOnly(2026, 9, 30);
    expect(d.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("month 从 1 开始，不是 JS 的 0", () => {
    expect(dateOnly(2026, 1, 1).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(dateOnly(2026, 12, 31).toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  // 这条是本文件存在的理由：曾经用 new Date(y, m-1, d) 写库，
  // 在东八区被算成前一天的 16:00Z，落库少一天，倒计时跟着少一天。
  it("不等于本地午夜（除非恰好在 UTC 时区跑）", () => {
    const utcMidnight = dateOnly(2026, 9, 30);
    const localMidnight = new Date(2026, 8, 30);
    if (localMidnight.getTimezoneOffset() !== 0) {
      expect(utcMidnight.getTime()).not.toBe(localMidnight.getTime());
    }
    // 无论在哪个时区，UTC 口径读出来都必须是 9 月 30 日
    expect(formatDateOnly(utcMidnight)).toBe("2026-09-30");
  });
});

describe("todayAsDateOnly", () => {
  it("按本地日历取今天，再转成 UTC 午夜", () => {
    // 本地 2026-07-26 深夜，仍应算作 7 月 26 日
    const result = todayAsDateOnly(new Date(2026, 6, 26, 23, 59, 59));
    expect(result.toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });

  it("本地清晨也算同一天", () => {
    const result = todayAsDateOnly(new Date(2026, 6, 26, 0, 0, 1));
    expect(result.toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });
});

describe("diffInDays", () => {
  // 课题 B 的真实场景：2026-07-26 → 2026-09-30
  it("跨月计算正确", () => {
    const days = diffInDays(dateOnly(2026, 9, 30), todayAsDateOnly(new Date(2026, 6, 26, 14, 0)));
    // 7 月剩 5 天 + 8 月 31 天 + 9 月 30 天
    expect(days).toBe(66);
  });

  it("同一天是 0，过去为负", () => {
    const today = dateOnly(2026, 7, 26);
    expect(diffInDays(dateOnly(2026, 7, 26), today)).toBe(0);
    expect(diffInDays(dateOnly(2026, 7, 25), today)).toBe(-1);
  });

  it("跨年计算正确", () => {
    expect(diffInDays(dateOnly(2027, 1, 1), dateOnly(2026, 12, 31))).toBe(1);
  });

  it("闰年二月算得对", () => {
    expect(diffInDays(dateOnly(2028, 3, 1), dateOnly(2028, 2, 28))).toBe(2);
  });
});

describe("格式化", () => {
  it("按精度输出不同粒度", () => {
    const d = dateOnly(2026, 9, 30);
    expect(formatDateOnly(d)).toBe("2026-09-30");
    expect(formatYearMonth(d)).toBe("2026-09");
    expect(formatYearOnly(d)).toBe("2026 年");
  });

  it("月和日补零", () => {
    expect(formatDateOnly(dateOnly(2026, 1, 5))).toBe("2026-01-05");
    expect(formatYearMonth(dateOnly(2026, 1, 5))).toBe("2026-01");
  });
});
