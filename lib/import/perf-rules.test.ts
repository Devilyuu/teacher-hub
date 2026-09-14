import { describe, expect, it } from "vitest";
import {
  buildCatalogPlan,
  cleanRuleCell,
  majorCategoriesInOrder,
} from "./perf-rules";

function catalog(rules: unknown[], year = 2025) {
  return { year, source: "测试", rules };
}

function rule(over: Record<string, unknown> = {}) {
  return {
    category: "科研与社会服务工作",
    subcategory: "纵向课题（教科研）",
    base_rule: "3/项",
    national_rule: "25/项",
    provincial_rule: "15/项",
    city_rule: "10/项",
    school_rule: "3/项",
    college_rule: "——",
    remark: "个人申报",
    is_team: false,
    is_department_assigned: false,
    is_active: true,
    sort_order: 1,
    ...over,
  };
}

describe("cleanRuleCell · 占位符归一成 null", () => {
  // 源表是人手打的，长短破折号混用。存 "——" 会让界面显示一个没意义的破折号，
  // 还要求每个消费点再判一次
  it("各种破折号都算不适用", () => {
    expect(cleanRuleCell("——")).toBeNull();
    expect(cleanRuleCell("—")).toBeNull();
    expect(cleanRuleCell("--")).toBeNull();
    expect(cleanRuleCell("-")).toBeNull();
  });

  it("空白与 null 也算不适用", () => {
    expect(cleanRuleCell("")).toBeNull();
    expect(cleanRuleCell("   ")).toBeNull();
    expect(cleanRuleCell(null)).toBeNull();
    expect(cleanRuleCell(undefined)).toBeNull();
  });

  it("真实规则原样保留，只去首尾空白", () => {
    expect(cleanRuleCell(" 10/次 ")).toBe("10/次");
    expect(cleanRuleCell("0.5/万元（上限10分）")).toBe("0.5/万元（上限10分）");
    // 这条含逗号和括号，是最容易被误当成可解析结构的写法
    expect(cleanRuleCell("10/项（市级）、5/项（市辖区级）")).toBe(
      "10/项（市级）、5/项（市辖区级）",
    );
  });

  it("「0」是有效规则，不能当成空", () => {
    expect(cleanRuleCell("0")).toBe("0");
  });
});

describe("buildCatalogPlan", () => {
  it("年度取自目录头，不从每条规则上读", () => {
    const { drafts } = buildCatalogPlan(catalog([rule()], 2026));
    expect(drafts[0].year).toBe(2026);
  });

  it("六列分级规则原样搬，「——」变 null", () => {
    const { drafts } = buildCatalogPlan(catalog([rule()]));
    expect(drafts[0].baseRule).toBe("3/项");
    expect(drafts[0].nationalRule).toBe("25/项");
    expect(drafts[0].collegeRule).toBeNull();
  });

  it("备注整段保留，不做清洗", () => {
    const remark = "个人申报，\n赛前向学院报备，代表学校参赛（以证书或公示为准）";
    const { drafts } = buildCatalogPlan(catalog([rule({ remark })]));
    expect(drafts[0].remark).toBe(remark);
  });

  // 重复不能静默合并——源表出现重复多半是抄表串行了，得让人去看
  it("同年度内大类小类重复时跳过并告警", () => {
    const { drafts, warnings } = buildCatalogPlan(
      catalog([rule(), rule({ base_rule: "9/项" })]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].baseRule).toBe("3/项");
    expect(warnings.join()).toMatch(/重复/);
  });

  it("不同大类下的同名小类不算重复", () => {
    const { drafts, warnings } = buildCatalogPlan(
      catalog([rule(), rule({ category: "教学" })]),
    );
    expect(drafts).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("六个级别全空的仍入库，但要告警", () => {
    const empty = rule({
      base_rule: "",
      national_rule: "——",
      provincial_rule: "——",
      city_rule: "——",
      school_rule: "——",
      college_rule: "——",
    });
    const { drafts, warnings } = buildCatalogPlan(catalog([empty]));
    expect(drafts).toHaveLength(1);
    expect(warnings.join()).toMatch(/全空/);
  });

  it("停用条目照样入库——历史成果可能还挂在上面", () => {
    const { drafts } = buildCatalogPlan(catalog([rule({ is_active: false })]));
    expect(drafts[0].isActive).toBe(false);
  });

  it("缺必填字段直接抛错，不静默跳过", () => {
    expect(() => buildCatalogPlan(catalog([rule({ subcategory: "" })]))).toThrow();
    expect(() => buildCatalogPlan({ year: 2025, source: "x", rules: [] })).toThrow();
  });
});

describe("majorCategoriesInOrder", () => {
  it("按首次出现顺序去重，那就是学校表格的排列顺序", () => {
    const { drafts } = buildCatalogPlan(
      catalog([
        rule({ category: "师德师风及党建思政工作", subcategory: "a" }),
        rule({ category: "教学", subcategory: "b" }),
        rule({ category: "师德师风及党建思政工作", subcategory: "c" }),
      ]),
    );
    expect(majorCategoriesInOrder(drafts)).toEqual(["师德师风及党建思政工作", "教学"]);
  });
});
