import { describe, expect, it } from "vitest";
import { buildCatalogPlan, PERF_PACK_FORMAT } from "@/lib/import/perf-rules";
import { buildPromotionPlan, PROMOTION_PACK_FORMAT } from "@/lib/import/promotion-rules";
import { detectRulePack, perfPackOf, promotionPackOf, rulePackFileName } from "./pack";

const promotionSource = {
  ruleset: {
    year: 2026,
    source: "明湖职业技术学院职称评审量化表（虚构）",
    generalNotes: ["同一成果只按一项计分"],
    teacherTotal: 22,
    labTotal: 22,
    ideologyTotal: 22,
    // 2.1 不对教管系列开放，只剩 1.1 的 10 分
    eduAdminTotal: 10,
  },
  categories: [
    {
      code: "2.1",
      majorIndicator: "科研",
      majorCap: 12,
      minorIndicator: "纵向项目",
      scoringRule: "国家级6分",
      remark: null,
      cap: 12,
      capGroup: "2.1",
      capNote: null,
      appliesTo: ["TEACHER" as const, "LAB" as const, "IDEOLOGY" as const],
      projectEligible: true,
      sortOrder: 20,
    },
    {
      code: "1.1",
      majorIndicator: "教学",
      majorCap: 10,
      minorIndicator: "课程建设",
      scoringRule: null,
      remark: "以文件为准",
      cap: 10,
      capGroup: "1.1",
      capNote: null,
      appliesTo: ["TEACHER" as const, "LAB" as const, "IDEOLOGY" as const, "EDU_ADMIN" as const],
      projectEligible: false,
      sortOrder: 10,
    },
  ],
};

describe("promotionPackOf", () => {
  it("导出的规则包原样喂回 buildPromotionPlan，指标一项不差（格式就是导入格式）", () => {
    const pack = promotionPackOf(promotionSource);
    const plan = buildPromotionPlan(JSON.parse(JSON.stringify(pack)));
    expect(plan.warnings).toEqual([]);
    expect(plan.head).toMatchObject({ year: 2026, generalNotes: ["同一成果只按一项计分"], teacherTotal: 22 });
    expect(plan.drafts.map((d) => [d.code, d.minorIndicator, d.cap, d.projectEligible, d.remark])).toEqual([
      ["1.1", "课程建设", 10, false, "以文件为准"],
      ["2.1", "纵向项目", 12, true, null],
    ]);
  });

  it("带格式标记，按 sortOrder 排；空值不写进文件，独占上限不写组名", () => {
    const pack = promotionPackOf(promotionSource);
    expect(pack.format).toBe(PROMOTION_PACK_FORMAT);
    expect(pack.indicators.map((row) => row.code)).toEqual(["1.1", "2.1"]);
    expect(pack.indicators[0]).not.toHaveProperty("scoring_rule");
    expect(pack.indicators[0]).not.toHaveProperty("cap_group");
  });

  it("四个系列总分不全时不写 seriesTotals", () => {
    const pack = promotionPackOf({ ...promotionSource, ruleset: { ...promotionSource.ruleset, labTotal: null } });
    expect(pack).not.toHaveProperty("seriesTotals");
  });
});

describe("perfPackOf", () => {
  it("往返：导出再导入，开关都带着", () => {
    const pack = perfPackOf({
      year: 2025,
      categories: [
        {
          majorCategory: "教科研项目",
          minorCategory: "纵向项目立项",
          baseRule: "3/项",
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
          sortOrder: 10,
        },
      ],
    });
    expect(pack.format).toBe(PERF_PACK_FORMAT);
    const { drafts, warnings } = buildCatalogPlan(JSON.parse(JSON.stringify(pack)));
    expect(warnings).toEqual([]);
    expect(drafts[0]).toMatchObject({
      year: 2025,
      baseRule: "3/项",
      nationalRule: "30/项",
      isActive: false,
      projectEligible: true,
      sortOrder: 10,
    });
  });
});

describe("detectRulePack", () => {
  it("先认格式标记，没有标记按键名认", () => {
    expect(detectRulePack({ format: PROMOTION_PACK_FORMAT }).table).toBe("promotion");
    expect(detectRulePack({ indicators: [] }).table).toBe("promotion");
    expect(detectRulePack({ rules: [] }).table).toBe("perf");
  });

  it("认不出的给一句人话", () => {
    expect(detectRulePack([1, 2])).toMatchObject({ table: null });
    expect(detectRulePack({ foo: 1 })).toMatchObject({ table: null, reason: expect.stringContaining("indicators") });
  });
});

describe("rulePackFileName", () => {
  it("两张表各一个名字，带年度", () => {
    expect(rulePackFileName("promotion", 2026)).toBe("职称量化表-2026.json");
    expect(rulePackFileName("perf", 2025)).toBe("绩效对照表-2025.json");
  });
});
