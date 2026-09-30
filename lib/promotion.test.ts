import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  compareIndicatorCode,
  defaultPromotionDeclareYear,
  groupByMajorIndicator,
  inPromotionWindow,
  parsePromotionDeclareYear,
  projectIndicatorOptions,
  promotionDeclareYearOptions,
  promotionOptionLabel,
  promotionWindow,
  applyPromotionCaps,
  type PromotionCapRule,
  type PromotionOption,
} from "@/lib/promotion";

function opt(
  code: string,
  majorIndicator: string,
  minorIndicator: string,
  projectEligible = false,
): PromotionOption {
  return {
    id: `id-${code}`,
    code,
    majorIndicator,
    minorIndicator,
    cap: null,
    scoringRule: null,
    projectEligible,
  };
}

const sample: PromotionOption[] = [
  opt("5.2", "科研成果及业绩", "纵向课题", true),
  opt("4.10", "教育教学", "课程建设"),
  opt("4.9", "教育教学", "专业建设"),
  opt("5.3", "科研成果及业绩", "横向项目和知识产权", true),
  opt("1.1", "思想政治素质", "思政表彰"),
];

describe("compareIndicatorCode", () => {
  it("4.10 排在 4.9 之后", () => {
    expect(compareIndicatorCode("4.9", "4.10")).toBeLessThan(0);
  });

  it("先比一级再比二级", () => {
    expect(compareIndicatorCode("5.1", "4.10")).toBeGreaterThan(0);
  });

  // 别的学校的编号五花八门，原来只认「数字.数字」，碰上这些会比出 NaN、整张表排乱
  it("字母加数字：A2 在 A10 前", () => {
    expect(["A10", "B1", "A2"].sort(compareIndicatorCode)).toEqual(["A2", "A10", "B1"]);
  });

  it("中文数字按数值比：（二）在（十）前、「十二」在「九」后", () => {
    expect(["（十）", "（二）", "（三）"].sort(compareIndicatorCode)).toEqual(["（二）", "（三）", "（十）"]);
    expect(["十二、1", "九、1", "一、2", "一、1"].sort(compareIndicatorCode)).toEqual([
      "一、1",
      "一、2",
      "九、1",
      "十二、1",
    ]);
  });

  it("只有序号的表：2 在 10 前", () => {
    expect(["10", "2", "1"].sort(compareIndicatorCode)).toEqual(["1", "2", "10"]);
  });

  it("两个编号一样时返回 0，排序稳定", () => {
    expect(compareIndicatorCode("5.2", "5.2")).toBe(0);
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
  it("只留勾了「课题可挂」的，按编号排", () => {
    expect(projectIndicatorOptions(sample).map((o) => o.code)).toEqual(["5.2", "5.3"]);
  });

  it("不做纵向→5.2 的自动匹配，只是把候选摆出来（第 11 条）", () => {
    // 返回的是候选列表而不是单个结果——这就是"不映射"在类型上的体现
    expect(projectIndicatorOptions(sample)).toHaveLength(2);
  });

  it("不看编号：别的学校勾的是 2.1，就只出 2.1——原来写死 5.2 / 5.3，换一所学校一个都对不上", () => {
    const other = [opt("2.1", "科研", "纵向项目", true), opt("5.2", "服务", "社区服务")];
    expect(projectIndicatorOptions(other).map((o) => o.code)).toEqual(["2.1"]);
  });

  it("一项都没勾时候选是全部——刚导进来的表谁也没勾过，不能让课题表单没得选", () => {
    const untouched = sample.map((option) => ({ ...option, projectEligible: false }));
    expect(projectIndicatorOptions(untouched).map((o) => o.code)).toEqual([
      "1.1",
      "4.9",
      "4.10",
      "5.2",
      "5.3",
    ]);
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

/** 成果页职称口径和导出页职称表共用这一份，默认值不一致时两处看到的是两批东西 */
describe("申报年度", () => {
  it("可选今年、明年、后年，默认明年", () => {
    expect(promotionDeclareYearOptions(2026)).toEqual([2026, 2027, 2028]);
    expect(defaultPromotionDeclareYear(2026)).toBe(2027);
  });

  it("URL 上的值不在可选范围里时回落到默认值，不报错", () => {
    expect(parsePromotionDeclareYear("2028", 2026)).toBe(2028);
    expect(parsePromotionDeclareYear("2026", 2026)).toBe(2026);
    for (const raw of [null, undefined, "", "2025", "2029", "1e3", "2027.0"]) {
      expect(parsePromotionDeclareYear(raw, 2026)).toBe(2027);
    }
  });
});

describe("applyPromotionCaps", () => {
  // 三层上限各来一个：4.5/4.6 共用 9 分，5.1、5.2 各自 10 分，两个一级指标 60 / 50
  const rules: PromotionCapRule[] = [
    { code: "4.5", majorIndicator: "教育教学", minorIndicator: "指导学生获奖", majorCap: 60, cap: 9, capGroup: "4.5+4.6" },
    { code: "4.6", majorIndicator: "教育教学", minorIndicator: "指导毕业设计获优秀", majorCap: 60, cap: 9, capGroup: "4.5+4.6" },
    { code: "5.1", majorIndicator: "科研成果及业绩", minorIndicator: "论文", majorCap: 50, cap: 10, capGroup: "5.1" },
    { code: "5.2", majorIndicator: "科研成果及业绩", minorIndicator: "纵向课题", majorCap: 50, cap: 10, capGroup: "5.2" },
  ];
  const e = (code: string, score: number) => ({
    code,
    majorIndicator: code.startsWith("4") ? "教育教学" : "科研成果及业绩",
    score,
  });

  /** CLAUDE.md 导师模块那条：参赛和毕设在职称口径下抢同一个 9 分 */
  it("共用封顶组按组截：4.5 填 7、4.6 填 5，只计 9", () => {
    const result = applyPromotionCaps([e("4.5", 7), e("4.6", 5)], rules);
    expect(result.rawTotal).toBe(12);
    expect(result.cappedTotal).toBe(9);
    expect(result.groups).toEqual([
      { key: "4.5+4.6", majorIndicator: "教育教学", codes: ["4.5", "4.6"], raw: 12, cap: 9, counted: 9 },
    ]);
    expect(result.overCap).toEqual([{ label: "4.5+4.6", raw: 12, cap: 9 }]);
  });

  it("独占的栏各截各的，没超的原样计入", () => {
    const result = applyPromotionCaps([e("5.1", 13), e("5.2", 6)], rules);
    expect(result.cappedTotal).toBe(16);
    expect(result.overCap).toEqual([{ label: "5.1", raw: 13, cap: 10 }]);
  });

  it("都没超上限时合计就是原始分，不报任何截断", () => {
    const result = applyPromotionCaps([e("4.5", 3), e("5.1", 4)], rules);
    expect(result.cappedTotal).toBe(result.rawTotal);
    expect(result.overCap).toEqual([]);
  });

  it("组内先把扣分冲抵掉再截", () => {
    const result = applyPromotionCaps([e("5.1", 12), e("5.1", -3)], rules);
    expect(result.cappedTotal).toBe(9);
    expect(result.overCap).toEqual([]);
  });

  /** 宁可多算也不凭空砍分；cap 为 null 让界面看得出这栏没对上表 */
  it("当前表里查不到的编号不截，原样计入", () => {
    const result = applyPromotionCaps([e("5.9", 30)], rules);
    expect(result.cappedTotal).toBe(30);
    expect(result.groups[0]).toMatchObject({ key: "5.9", cap: null, counted: 30 });
  });

  it("一级指标上限在各组截完之后再截一次", () => {
    const tight: PromotionCapRule[] = [
      { code: "9.1", majorIndicator: "测试", minorIndicator: "甲", majorCap: 10, cap: 8, capGroup: "9.1" },
      { code: "9.2", majorIndicator: "测试", minorIndicator: "乙", majorCap: 10, cap: 8, capGroup: "9.2" },
    ];
    const result = applyPromotionCaps(
      [
        { code: "9.1", majorIndicator: "测试", score: 9 },
        { code: "9.2", majorIndicator: "测试", score: 8 },
      ],
      tight,
    );
    expect(result.majors).toEqual([{ majorIndicator: "测试", raw: 16, cap: 10, counted: 10 }]);
    expect(result.cappedTotal).toBe(10);
    expect(result.overCap).toEqual([
      { label: "9.1", raw: 9, cap: 8 },
      { label: "测试", raw: 16, cap: 10 },
    ]);
  });

  it("小数分相加不冒浮点尾巴", () => {
    const result = applyPromotionCaps([e("5.1", 0.1), e("5.1", 0.2)], rules);
    expect(result.rawTotal).toBe(0.3);
    expect(result.cappedTotal).toBe(0.3);
  });
});
