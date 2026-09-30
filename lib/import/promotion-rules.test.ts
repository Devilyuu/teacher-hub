import { describe, expect, it } from "vitest";
import {
  buildPromotionPlan,
  compareCode,
  sumCapsByGroup,
} from "@/lib/import/promotion-rules";

function minimalDoc(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    source: "测试",
    seriesTotals: { teacher: 3, lab: 3, ideology: 1, eduAdmin: 1 },
    generalNotes: ["说明一"],
    indicators: [
      {
        code: "1.1",
        major_indicator: "甲",
        major_cap: 1,
        minor_indicator: "甲一",
        scoring_rule: "国家级1分",
        cap: 1,
        cap_group: "1.1",
        applies_to: ["TEACHER", "LAB", "IDEOLOGY", "EDU_ADMIN"],
      },
      {
        code: "2.1",
        major_indicator: "乙",
        major_cap: 2,
        minor_indicator: "乙一",
        scoring_rule: "省级2分",
        cap: 2,
        cap_group: "2.1",
        applies_to: ["TEACHER", "LAB"],
      },
    ],
    ...overrides,
  };
}

describe("compareCode", () => {
  it("4.10 排在 4.9 之后，不能按字符串比", () => {
    expect(compareCode("4.9", "4.10")).toBeLessThan(0);
    expect(["4.10", "4.2", "4.9"].sort(compareCode)).toEqual(["4.2", "4.9", "4.10"]);
  });

  it("先比一级再比二级", () => {
    expect(compareCode("5.1", "4.10")).toBeGreaterThan(0);
  });
});

describe("sumCapsByGroup", () => {
  it("共用封顶只算一次", () => {
    expect(
      sumCapsByGroup([
        { capGroup: "2.3+2.4", cap: 3 },
        { capGroup: "2.3+2.4", cap: 3 },
        { capGroup: "2.5", cap: 2 },
      ]),
    ).toBe(5);
  });

  it("cap 为 null 的不计入", () => {
    expect(sumCapsByGroup([{ capGroup: "a", cap: null }, { capGroup: "b", cap: 4 }])).toBe(4);
  });
});

describe("buildPromotionPlan", () => {
  it("按编号排序并写 sortOrder", () => {
    const plan = buildPromotionPlan(minimalDoc());
    expect(plan.drafts.map((d) => d.code)).toEqual(["1.1", "2.1"]);
    expect(plan.drafts.map((d) => d.sortOrder)).toEqual([0, 1]);
  });

  it("头部信息原样带出", () => {
    const plan = buildPromotionPlan(minimalDoc());
    expect(plan.head.year).toBe(2026);
    expect(plan.head.teacherTotal).toBe(3);
    expect(plan.head.generalNotes).toEqual(["说明一"]);
  });

  it("编号重复的跳过并告警，不静默合并", () => {
    const doc = minimalDoc();
    const dup = { ...(doc.indicators as Array<Record<string, unknown>>)[0] };
    (doc.indicators as Array<Record<string, unknown>>).push(dup);
    const plan = buildPromotionPlan(doc);
    expect(plan.drafts).toHaveLength(2);
    expect(plan.warnings.some((w) => w.includes("1.1") && w.includes("重复"))).toBe(true);
  });

  it("同一封顶组出现不同上限时告警", () => {
    const doc = minimalDoc();
    (doc.indicators as Array<Record<string, unknown>>)[1].cap_group = "1.1";
    const plan = buildPromotionPlan(doc);
    expect(plan.warnings.some((w) => w.includes("共用封顶组"))).toBe(true);
  });

  it("封顶对不上只告警，不抛异常——人事处改表也得导得进来", () => {
    const doc = minimalDoc({ seriesTotals: { teacher: 99, lab: 3, ideology: 1, eduAdmin: 1 } });
    const plan = buildPromotionPlan(doc);
    expect(plan.drafts).toHaveLength(2);
    expect(plan.checks.find((c) => c.label.includes("教师系列"))?.ok).toBe(false);
    expect(plan.warnings.some((w) => w.includes("教师系列"))).toBe(true);
  });

  it("空编号会被 zod 挡住", () => {
    const doc = minimalDoc();
    (doc.indicators as Array<Record<string, unknown>>)[0].code = "  ";
    expect(() => buildPromotionPlan(doc)).toThrow();
  });
});

/**
 * 别的学校的表（2026-09-27 放宽）：编号格式不限，一级上限、本栏上限、赋分原文、
 * 适用系列、系列总分、整表说明都可以没有。缺了哪一重校验就不跑，不报假告警。
 */
describe("buildPromotionPlan · 别的学校的表", () => {
  const bare = {
    year: 2026,
    source: "明湖职业技术学院职称评审量化表（虚构）",
    indicators: [
      { code: "A2", major_indicator: "教学", minor_indicator: "课程建设" },
      { code: "A10", major_indicator: "教学", minor_indicator: "教学竞赛" },
      { code: "B1", major_indicator: "科研", minor_indicator: "纵向项目", project_eligible: true },
    ],
  };

  it("只有编号和两级指标名也能导，编号按自然序排", () => {
    const plan = buildPromotionPlan(bare);
    expect(plan.drafts.map((d) => d.code)).toEqual(["A2", "A10", "B1"]);
    expect(plan.drafts[0]).toMatchObject({
      majorCap: null,
      cap: null,
      scoringRule: null,
      capGroup: "A2",
      appliesTo: [],
    });
  });

  it("没有上限、没有系列总分时一重校验都不跑，零告警", () => {
    const plan = buildPromotionPlan(bare);
    expect(plan.checks).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.head).toMatchObject({ generalNotes: [], teacherTotal: null, eduAdminTotal: null });
  });

  it("「课题可挂」没写就是 undefined（写库时保留原值），写了照搬", () => {
    const plan = buildPromotionPlan(bare);
    expect(plan.drafts.find((d) => d.code === "A2")?.projectEligible).toBeUndefined();
    expect(plan.drafts.find((d) => d.code === "B1")?.projectEligible).toBe(true);
  });

  it("一级上限只写在某一行上，同组别的行也认它（粘贴来的表常常只在合并单元格第一行有值）", () => {
    const plan = buildPromotionPlan({
      ...bare,
      indicators: [
        { code: "1.1", major_indicator: "教学", major_cap: 20, minor_indicator: "课程", cap: 12 },
        { code: "1.2", major_indicator: "教学", minor_indicator: "竞赛", cap: 8 },
      ],
    });
    expect(plan.drafts.map((d) => d.majorCap)).toEqual([20, 20]);
    expect(plan.checks).toEqual([{ label: "一级指标「教学」", expected: 20, actual: 20, ok: true }]);
  });

  it("有一栏没写上限时不比一级上限——加不出一个可比的数，比了只会报假告警", () => {
    const plan = buildPromotionPlan({
      ...bare,
      indicators: [
        { code: "1.1", major_indicator: "教学", major_cap: 20, minor_indicator: "课程", cap: 12 },
        { code: "1.2", major_indicator: "教学", minor_indicator: "竞赛" },
      ],
    });
    expect(plan.checks).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("同一个一级指标写了两个不同的上限：告警，各行照原样不替人挑", () => {
    const plan = buildPromotionPlan({
      ...bare,
      indicators: [
        { code: "1.1", major_indicator: "教学", major_cap: 20, minor_indicator: "课程" },
        { code: "1.2", major_indicator: "教学", major_cap: 30, minor_indicator: "竞赛" },
      ],
    });
    expect(plan.drafts.map((d) => d.majorCap)).toEqual([20, 30]);
    expect(plan.warnings.some((w) => w.includes("封顶分不一致"))).toBe(true);
  });

  it("编号超过 20 个字被挡住——多半是把整列说明指成了编号", () => {
    expect(() =>
      buildPromotionPlan({
        ...bare,
        indicators: [{ code: "一".repeat(21), major_indicator: "教学", minor_indicator: "课程" }],
      }),
    ).toThrow();
  });
});
