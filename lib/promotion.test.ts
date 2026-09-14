import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  compareIndicatorCode,
  groupByMajorIndicator,
  inPromotionWindow,
  projectIndicatorOptions,
  promotionOptionLabel,
  promotionWindow,
  type PromotionOption,
} from "@/lib/promotion";

function opt(code: string, majorIndicator: string, minorIndicator: string): PromotionOption {
  return { id: `id-${code}`, code, majorIndicator, minorIndicator, cap: null };
}

const sample: PromotionOption[] = [
  opt("5.2", "科研成果及业绩", "纵向课题"),
  opt("4.10", "教育教学", "课程建设"),
  opt("4.9", "教育教学", "专业建设"),
  opt("5.3", "科研成果及业绩", "横向项目和知识产权"),
  opt("1.1", "思想政治素质", "思政表彰"),
];

describe("compareIndicatorCode", () => {
  it("4.10 排在 4.9 之后", () => {
    expect(compareIndicatorCode("4.9", "4.10")).toBeLessThan(0);
  });
});

describe("promotionOptionLabel", () => {
  it("编号在前——申报表和跟人事处沟通都按编号来", () => {
    expect(promotionOptionLabel({ code: "5.2", minorIndicator: "纵向课题" })).toBe("5.2 纵向课题");
  });
});

describe("groupByMajorIndicator", () => {
  const grouped = groupByMajorIndicator(sample);

  it("按一级指标编号顺序出组", () => {
    expect(grouped.map((g) => g.majorIndicator)).toEqual([
      "思想政治素质",
      "教育教学",
      "科研成果及业绩",
    ]);
  });

  it("组内按编号排，4.10 在 4.9 后面", () => {
    const teaching = grouped.find((g) => g.majorIndicator === "教育教学");
    expect(teaching?.items.map((i) => i.code)).toEqual(["4.9", "4.10"]);
  });
});

describe("projectIndicatorOptions", () => {
  it("只留 5.2 和 5.3", () => {
    expect(projectIndicatorOptions(sample).map((o) => o.code)).toEqual(["5.2", "5.3"]);
  });

  it("不做纵向→5.2 的自动匹配，只是把两项摆出来（第 11 条）", () => {
    // 返回的是候选列表而不是单个结果——这就是"不映射"在类型上的体现
    expect(projectIndicatorOptions(sample)).toHaveLength(2);
  });
});

describe("promotionWindow", () => {
  it("终点是申报年度的上一年，不是今年", () => {
    expect(promotionWindow(dateOnly(2016, 9, 1), 2026).toYear).toBe(2025);
  });

  it("起点原样带出", () => {
    const from = dateOnly(2016, 9, 1);
    expect(promotionWindow(from, 2026).from).toEqual(from);
  });
});

describe("inPromotionWindow", () => {
  const window = promotionWindow(dateOnly(2016, 9, 1), 2026);

  it("2025 年的成果在窗内", () => {
    expect(inPromotionWindow({ year: 2025 }, window)).toBe(true);
  });

  it("2026 年的成果超窗——申报年度当年的不算", () => {
    expect(inPromotionWindow({ year: 2026 }, window)).toBe(false);
  });

  it("2016 年的成果在窗内（取得现职称当年）", () => {
    expect(inPromotionWindow({ year: 2016 }, window)).toBe(true);
  });

  it("2015 年的成果超窗——任现职之前的不算", () => {
    expect(inPromotionWindow({ year: 2015 }, window)).toBe(false);
  });

  it("年度未填的算在窗内，不能悄悄藏起来", () => {
    expect(inPromotionWindow({ year: null }, window)).toBe(true);
  });

  it("档案没填任现职日期时只卡上限", () => {
    const noSince = promotionWindow(null, 2026);
    expect(inPromotionWindow({ year: 1999 }, noSince)).toBe(true);
    expect(inPromotionWindow({ year: 2026 }, noSince)).toBe(false);
  });
});
