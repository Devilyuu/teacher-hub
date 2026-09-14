import { describe, expect, it } from "vitest";
import { formatPerfRules, type PerfRuleColumns } from "./perf-rules";

const EMPTY: PerfRuleColumns = {
  baseRule: null,
  nationalRule: null,
  provincialRule: null,
  cityRule: null,
  schoolRule: null,
  collegeRule: null,
};

describe("formatPerfRules", () => {
  it("只拼有值的列，按申报表原顺序", () => {
    expect(
      formatPerfRules({
        ...EMPTY,
        baseRule: "8/门",
        provincialRule: "10/项",
        cityRule: "5/项",
      }),
    ).toBe("基本分 8/门　省级 10/项　市级 5/项");
  });

  it("整行没有规则时返回空串，而不是一串孤零零的标签", () => {
    // 源表里确实有整行「——」的条目
    expect(formatPerfRules(EMPTY)).toBe("");
  });

  it("空白字符串当作没填", () => {
    expect(formatPerfRules({ ...EMPTY, baseRule: "   ", cityRule: "3/项" })).toBe("市级 3/项");
  });

  /**
   * 规则原文一律不解析。源表里这些写法没有统一语法，
   * 硬解析必然出错——这里只保证原样透传。
   */
  it.each([
    "10/次",
    "0.5/万元（上限10分）",
    "10、8、6/项",
    "10/项（市级）、5/项（市辖区级）",
  ])("原样透传不解析：%s", (rule) => {
    expect(formatPerfRules({ ...EMPTY, baseRule: rule })).toBe(`基本分 ${rule}`);
  });
});
