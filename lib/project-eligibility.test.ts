import { describe, expect, it } from "vitest";
import { hasProjectEligible, projectEligibleOf } from "./project-eligibility";

const row = (id: string, projectEligible: boolean) => ({ id, projectEligible });

describe("projectEligibleOf", () => {
  it("有勾的就只留勾了的，顺序不变", () => {
    expect(projectEligibleOf([row("a", false), row("b", true), row("c", true)]).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("一项都没勾时原样返回全部", () => {
    expect(projectEligibleOf([row("a", false), row("b", false)]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("空表返回空，不报错", () => {
    expect(projectEligibleOf([])).toEqual([]);
  });

  it("返回新数组，调用方拿去排序不会改到原来的", () => {
    const rows = [row("a", false)];
    expect(projectEligibleOf(rows)).not.toBe(rows);
  });
});

describe("hasProjectEligible", () => {
  it("有没有人勾过", () => {
    expect(hasProjectEligible([row("a", false)])).toBe(false);
    expect(hasProjectEligible([row("a", false), row("b", true)])).toBe(true);
  });
});
