import { describe, expect, it } from "vitest";
import type { PerfCategoryDraft } from "@/lib/import/perf-rules";
import type { PromotionCategoryDraft } from "@/lib/import/promotion-rules";
import { diffPerf, diffPromotion, type ExistingPerfRow, type ExistingPromotionRow } from "./preview";

function promotionDraft(over: Partial<PromotionCategoryDraft> = {}): PromotionCategoryDraft {
  return {
    year: 2026,
    code: "1.1",
    majorIndicator: "教学",
    majorCap: null,
    minorIndicator: "课程建设",
    scoringRule: "国家级8分",
    remark: null,
    cap: 10,
    capGroup: "1.1",
    capNote: null,
    appliesTo: [],
    projectEligible: undefined,
    sortOrder: 0,
    ...over,
  };
}

function promotionRow(over: Partial<ExistingPromotionRow> = {}): ExistingPromotionRow {
  return {
    code: "1.1",
    majorIndicator: "教学",
    majorCap: null,
    minorIndicator: "课程建设",
    scoringRule: "国家级8分",
    remark: null,
    cap: 10,
    capGroup: "1.1",
    capNote: null,
    appliesTo: [],
    projectEligible: false,
    linkedCount: 0,
    ...over,
  };
}

describe("diffPromotion", () => {
  it("按编号比：新增、不变、改了哪几项", () => {
    const diff = diffPromotion(
      [promotionRow(), promotionRow({ code: "1.2", minorIndicator: "教学竞赛", cap: 8, capGroup: "1.2" })],
      [
        promotionDraft(),
        promotionDraft({ code: "1.2", minorIndicator: "教学竞赛", cap: 6, capGroup: "1.2", scoringRule: "一等奖5分" }),
        promotionDraft({ code: "2.1", majorIndicator: "科研", minorIndicator: "纵向项目", capGroup: "2.1" }),
      ],
    );
    expect(diff.counts).toEqual({ new: 1, changed: 1, same: 1 });
    expect(diff.rows.find((row) => row.key === "1.2")?.changedFields).toEqual(["赋分原文", "本栏上限"]);
  });

  it("「课题可挂」文件里没写（undefined）时不算改动——写库时本来就保留原值", () => {
    const diff = diffPromotion([promotionRow({ projectEligible: true })], [promotionDraft()]);
    expect(diff.counts.same).toBe(1);
  });

  it("库里有、这次没有的列进 untouched，带着挂了几条", () => {
    const diff = diffPromotion([promotionRow({ code: "9.9", minorIndicator: "旧指标", linkedCount: 3 })], [promotionDraft()]);
    expect(diff.untouched).toEqual([{ label: "9.9 旧指标", linkedCount: 3 }]);
  });

  it("库里 capGroup 是空的老数据，按编号当独占组比，不算改动", () => {
    const diff = diffPromotion([promotionRow({ capGroup: null })], [promotionDraft()]);
    expect(diff.counts.same).toBe(1);
  });
});

function perfDraft(over: Partial<PerfCategoryDraft> = {}): PerfCategoryDraft {
  return {
    year: 2026,
    majorCategory: "教科研项目",
    minorCategory: "纵向项目立项",
    baseRule: null,
    nationalRule: "30/项",
    provincialRule: null,
    cityRule: null,
    schoolRule: null,
    collegeRule: null,
    remark: null,
    isTeam: undefined,
    isDepartmentAssigned: undefined,
    isActive: undefined,
    projectEligible: undefined,
    sortOrder: 10,
    ...over,
  };
}

function perfRow(over: Partial<ExistingPerfRow> = {}): ExistingPerfRow {
  return {
    majorCategory: "教科研项目",
    minorCategory: "纵向项目立项",
    baseRule: null,
    nationalRule: "30/项",
    provincialRule: null,
    cityRule: null,
    schoolRule: null,
    collegeRule: null,
    remark: null,
    isTeam: false,
    isDepartmentAssigned: false,
    isActive: false,
    projectEligible: true,
    linkedCount: 0,
    ...over,
  };
}

describe("diffPerf", () => {
  it("按大类 + 小类比，开关没写就不算改动（停用、课题可挂都保留原值）", () => {
    const diff = diffPerf([perfRow()], [perfDraft()]);
    expect(diff.counts.same).toBe(1);
  });

  it("规则列改了、开关写了不一样的值，都列出来", () => {
    const diff = diffPerf([perfRow()], [perfDraft({ nationalRule: "25/项", isActive: true })]);
    expect(diff.rows[0]?.changedFields).toEqual(["国家级", "启用"]);
  });

  it("预览第三列是规则拼好的一行", () => {
    const diff = diffPerf([], [perfDraft({ baseRule: "3/项" })]);
    expect(diff.rows[0]).toMatchObject({ change: "new", detail: "基本分 3/项　国家级 30/项" });
  });
});
