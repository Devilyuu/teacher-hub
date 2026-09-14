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

  it("编号写错格式会被 zod 挡住", () => {
    const doc = minimalDoc();
    (doc.indicators as Array<Record<string, unknown>>)[0].code = "五点二";
    expect(() => buildPromotionPlan(doc)).toThrow();
  });
});
