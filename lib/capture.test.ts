import { describe, expect, it } from "vitest";
import { capForHome, isPendingCapture, pendingCaptures, type CaptureLike } from "./capture";
import { dateOnly } from "./date";

const TODAY = dateOnly(2026, 7, 29);

function make(overrides: Partial<CaptureLike> = {}): CaptureLike {
  return { status: "INBOX", snoozedUntil: null, ...overrides };
}

describe("isPendingCapture", () => {
  it("INBOX 一律待处理", () => {
    expect(isPendingCapture(make(), TODAY)).toBe(true);
  });

  it("已转换和已忽略的不再出现", () => {
    expect(isPendingCapture(make({ status: "CONVERTED" }), TODAY)).toBe(false);
    expect(isPendingCapture(make({ status: "DISMISSED" }), TODAY)).toBe(false);
  });

  /**
   * 延期的意思是「今天别烦我」，不是「删掉」。到期必须自己浮回来，
   * 否则延期一次就等于永远消失——那是收件箱最容易出的静默数据丢失。
   */
  it("延期未到期时不出现，到期当天回来", () => {
    expect(
      isPendingCapture(make({ status: "SNOOZED", snoozedUntil: dateOnly(2026, 7, 30) }), TODAY),
    ).toBe(false);
    expect(
      isPendingCapture(make({ status: "SNOOZED", snoozedUntil: dateOnly(2026, 7, 29) }), TODAY),
    ).toBe(true);
    expect(
      isPendingCapture(make({ status: "SNOOZED", snoozedUntil: dateOnly(2026, 7, 28) }), TODAY),
    ).toBe(true);
  });

  it("延期了却没填日期的当作待处理，不让它彻底消失", () => {
    expect(isPendingCapture(make({ status: "SNOOZED", snoozedUntil: null }), TODAY)).toBe(true);
  });
});

describe("pendingCaptures", () => {
  it("按记录时间正序——先记的先处理，旧条目不沉底", () => {
    const items = [
      { ...make(), createdAt: new Date("2026-07-29T10:00:00Z"), id: "new" },
      { ...make(), createdAt: new Date("2026-07-27T10:00:00Z"), id: "old" },
      { ...make(), createdAt: new Date("2026-07-28T10:00:00Z"), id: "mid" },
    ];
    expect(pendingCaptures(items, TODAY).map((i) => i.id)).toEqual(["old", "mid", "new"]);
  });

  it("过滤掉已处理的", () => {
    const items = [
      { ...make(), createdAt: new Date("2026-07-27T10:00:00Z"), id: "a" },
      { ...make({ status: "CONVERTED" }), createdAt: new Date("2026-07-28T10:00:00Z"), id: "b" },
      {
        ...make({ status: "SNOOZED", snoozedUntil: dateOnly(2026, 8, 5) }),
        createdAt: new Date("2026-07-28T11:00:00Z"),
        id: "c",
      },
    ];
    expect(pendingCaptures(items, TODAY).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("capForHome", () => {
  it("不超上限时全显示，overflow 为 0", () => {
    expect(capForHome([1, 2, 3])).toEqual({ shown: [1, 2, 3], overflow: 0 });
  });

  /**
   * 超出的不是丢掉，是显示「还有 N 条」。库里有 70 条未核实成果，
   * 全铺在首页会把「今天要处理」挤出屏幕，整个队列就失去意义。
   */
  it("超出上限时截断并报出剩余条数", () => {
    const many = Array.from({ length: 70 }, (_, i) => i);
    const result = capForHome(many);
    expect(result.shown).toHaveLength(8);
    expect(result.overflow).toBe(62);
    expect(result.shown[0]).toBe(0);
  });

  it("上限可以按分区调", () => {
    expect(capForHome([1, 2, 3, 4], 2)).toEqual({ shown: [1, 2], overflow: 2 });
  });
});
