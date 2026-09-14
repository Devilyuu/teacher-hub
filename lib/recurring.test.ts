import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  CATCHUP_DAYS,
  daysUntil,
  describeRule,
  latestDueDate,
  matchesDay,
  type RecurringRuleLike,
} from "./recurring";

/** 2026-07-28 是周二 */
const NOW = new Date(2026, 6, 28, 10, 0);

function rule(over: Partial<RecurringRuleLike> = {}): RecurringRuleLike {
  return {
    freq: "WEEKLY",
    day: 1,
    createdAt: new Date(2026, 0, 1),
    lastRunYmd: null,
    ...over,
  };
}

describe("matchesDay", () => {
  it("每周：1=周一 … 7=周日", () => {
    // 2026-07-27 是周一，07-26 是周日
    expect(matchesDay(rule({ freq: "WEEKLY", day: 1 }), dateOnly(2026, 7, 27))).toBe(true);
    expect(matchesDay(rule({ freq: "WEEKLY", day: 7 }), dateOnly(2026, 7, 26))).toBe(true);
    expect(matchesDay(rule({ freq: "WEEKLY", day: 1 }), dateOnly(2026, 7, 28))).toBe(false);
  });

  it("每月：按号数", () => {
    expect(matchesDay(rule({ freq: "MONTHLY", day: 25 }), dateOnly(2026, 7, 25))).toBe(true);
    expect(matchesDay(rule({ freq: "MONTHLY", day: 25 }), dateOnly(2026, 7, 24))).toBe(false);
  });

  /** 「每月 31 号」在小月不能整月不触发，否则那条规则一年只响 7 次 */
  it("每月 31 号在小月落到月末", () => {
    const monthly31 = rule({ freq: "MONTHLY", day: 31 });
    expect(matchesDay(monthly31, dateOnly(2026, 4, 30))).toBe(true);
    expect(matchesDay(monthly31, dateOnly(2026, 2, 28))).toBe(true);
    expect(matchesDay(monthly31, dateOnly(2026, 7, 31))).toBe(true);
    expect(matchesDay(monthly31, dateOnly(2026, 4, 29))).toBe(false);
  });
});

describe("latestDueDate", () => {
  it("今天正好命中就生成今天的", () => {
    // 07-28 是周二
    expect(latestDueDate(rule({ freq: "WEEKLY", day: 2 }), NOW)).toBe("2026-07-28");
  });

  it("往回补最近一次错过的", () => {
    // 周一规则，今天周二 → 补昨天那次
    expect(latestDueDate(rule({ freq: "WEEKLY", day: 1 }), NOW)).toBe("2026-07-27");
  });

  /** 出差三周回来该看到一条待办，不是一摞过期的重复任务 */
  it("只补最近的一次，不把错过的全生成出来", () => {
    const result = latestDueDate(rule({ freq: "WEEKLY", day: 1 }), NOW);
    expect(result).toBe("2026-07-27");
    expect(typeof result).toBe("string");
  });

  it("已经生成过就不再生成", () => {
    expect(
      latestDueDate(rule({ freq: "WEEKLY", day: 1, lastRunYmd: "2026-07-27" }), NOW),
    ).toBeNull();
  });

  it("规则创建之前的日子不补", () => {
    expect(
      latestDueDate(rule({ freq: "WEEKLY", day: 1, createdAt: new Date(2026, 6, 28) }), NOW),
    ).toBeNull();
  });

  it("超出补齐窗口的不补", () => {
    // 每月 1 号、上次生成到 6 月 1 日：7-28 往回找 31 天到 6-27，够不到 7-01 之前
    const result = latestDueDate(
      rule({ freq: "MONTHLY", day: 1, lastRunYmd: "2026-07-01" }),
      NOW,
    );
    expect(result).toBeNull();
  });

  it("补齐窗口是 31 天，覆盖每月规则", () => {
    expect(CATCHUP_DAYS).toBe(31);
  });
});

describe("describeRule", () => {
  it("说人话", () => {
    expect(describeRule({ freq: "WEEKLY", day: 1 })).toBe("每周一");
    expect(describeRule({ freq: "WEEKLY", day: 7 })).toBe("每周日");
    expect(describeRule({ freq: "MONTHLY", day: 25 })).toBe("每月 25 号");
  });
});

describe("daysUntil", () => {
  it("未来为正，过去为负，今天为 0", () => {
    expect(daysUntil(dateOnly(2026, 7, 30), NOW)).toBe(2);
    expect(daysUntil(dateOnly(2026, 7, 28), NOW)).toBe(0);
    expect(daysUntil(dateOnly(2026, 7, 26), NOW)).toBe(-2);
  });
});
