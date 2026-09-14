import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import { promotionWindow } from "@/lib/promotion";
import {
  filterAchievements,
  hasScoreWithoutCategory,
  majorFacets,
  minorFacets,
  matchesFilters,
  missingYearCount,
  parseScope,
  promotionExclusion,
  promotionExclusionCounts,
  promotionMinorFacets,
  scoreWithoutCategoryCount,
  sumDeclaredScore,
  sumPromotionScore,
  usageFacets,
  yearFacets,
  type FilterableAchievement,
} from "./achievement-filters";

function item(over: Partial<FilterableAchievement> = {}): FilterableAchievement {
  return {
    year: 2025,
    perfCategory: { majorCategory: "科研与社会服务工作" },
    promotionCategoryId: null,
    usableFor: ["PERFORMANCE"],
    needsLink: false,
    isVerified: false,
    ...over,
  };
}

describe("matchesFilters", () => {
  it("空筛选放行一切", () => {
    expect(matchesFilters(item(), {})).toBe(true);
  });

  it("年度精确匹配", () => {
    expect(matchesFilters(item({ year: 2025 }), { year: 2025 })).toBe(true);
    expect(matchesFilters(item({ year: 2026 }), { year: 2025 })).toBe(false);
  });

  // 没填年度的不该被任何具体年度捞进去——它是待订正，不是"属于某年"
  it("年度为空时不匹配任何具体年度", () => {
    expect(matchesFilters(item({ year: null }), { year: 2025 })).toBe(false);
  });

  it("大类匹配，没挂规则的不算", () => {
    expect(matchesFilters(item(), { major: "科研与社会服务工作" })).toBe(true);
    expect(matchesFilters(item({ perfCategory: null }), { major: "教学" })).toBe(false);
  });

  // 用途是多选，命中其中一个就算
  it("用途只要包含就算", () => {
    const both = item({ usableFor: ["PERFORMANCE", "PROMOTION"] });
    expect(matchesFilters(both, { usage: "PROMOTION" })).toBe(true);
    expect(matchesFilters(both, { usage: "PROJECT_CLOSING" })).toBe(false);
  });

  /**
   * 「该挂未挂」筛的是**勾了结题用途却没挂上**的，不是「没挂接」的。
   * 73 条成果里 69 条都没挂接（多数成果本来就不属于任何课题），
   * 按「没挂接」筛等于没筛。
   */
  it("该挂未挂与待确认两个开关", () => {
    expect(matchesFilters(item({ needsLink: false }), { needsLinkOnly: true })).toBe(false);
    expect(matchesFilters(item({ needsLink: true }), { needsLinkOnly: true })).toBe(true);
    expect(matchesFilters(item({ isVerified: true }), { unverifiedOnly: true })).toBe(false);
    expect(matchesFilters(item({ isVerified: false }), { unverifiedOnly: true })).toBe(true);
  });

  it("多个条件是与的关系", () => {
    const it2025 = item({ year: 2025, usableFor: ["PERFORMANCE"] });
    expect(matchesFilters(it2025, { year: 2025, usage: "PROMOTION" })).toBe(false);
    expect(matchesFilters(it2025, { year: 2025, usage: "PERFORMANCE" })).toBe(true);
  });

  it("null 与 undefined 都当没筛", () => {
    expect(matchesFilters(item({ year: 2026 }), { year: null })).toBe(true);
    expect(matchesFilters(item(), { major: null, usage: null })).toBe(true);
  });
});

describe("filterAchievements", () => {
  it("按条件筛出子集", () => {
    const items = [item({ year: 2025 }), item({ year: 2026 }), item({ year: 2026 })];
    expect(filterAchievements(items, { year: 2026 })).toHaveLength(2);
  });
});

describe("分面统计", () => {
  // 年底填报最关心当年和上一年
  it("年度降序", () => {
    const items = [item({ year: 2025 }), item({ year: 2026 }), item({ year: 2025 })];
    expect(yearFacets(items)).toEqual([
      { value: 2026, count: 1 },
      { value: 2025, count: 2 },
    ]);
  });

  it("未填年度单独计数，不混进年度分面", () => {
    const items = [item({ year: null }), item({ year: 2025 })];
    expect(yearFacets(items)).toEqual([{ value: 2025, count: 1 }]);
    expect(missingYearCount(items)).toBe(1);
  });

  // 学校 11 个大类里本人只用到几个，按表格原顺序排会让空大类占位置
  it("大类按条数降序", () => {
    const items = [
      item({ perfCategory: { majorCategory: "教学" } }),
      item({ perfCategory: { majorCategory: "科研与社会服务工作" } }),
      item({ perfCategory: { majorCategory: "科研与社会服务工作" } }),
      item({ perfCategory: null }),
    ];
    expect(majorFacets(items)).toEqual([
      { value: "科研与社会服务工作", count: 2 },
      { value: "教学", count: 1 },
    ]);
  });

  it("用途分面固定三档，零条也出现", () => {
    const facets = usageFacets([item({ usableFor: ["PERFORMANCE"] })]);
    expect(facets).toEqual([
      { value: "PERFORMANCE", count: 1 },
      { value: "PROMOTION", count: 0 },
      { value: "PROJECT_CLOSING", count: 0 },
    ]);
  });
});

describe("sumDeclaredScore", () => {
  it("累加，null 当 0", () => {
    expect(sumDeclaredScore([{ declaredScore: 3 }, { declaredScore: null }, { declaredScore: 5.5 }])).toBe(8.5);
  });

  // Prisma 的 Decimal 不是 number，直接相加会得到字符串拼接
  it("Decimal 这类对象按 Number() 转", () => {
    const decimalLike = { toString: () => "10.5", valueOf: () => "10.5" };
    expect(sumDeclaredScore([{ declaredScore: decimalLike }, { declaredScore: 2 }])).toBe(12.5);
  });

  it("转不出数字的跳过而不是变 NaN", () => {
    expect(sumDeclaredScore([{ declaredScore: "说不清" }, { declaredScore: 3 }])).toBe(3);
  });

  it("空数组是 0", () => {
    expect(sumDeclaredScore([])).toBe(0);
  });
});

/**
 * 口径切换。台账最外层的一刀，比年度、大类那些筛选都靠前。
 *
 * 关键判断：**「能不能评职称」看 promotionCategoryId 有没有值**——
 * 它是"在人事处那张表上坐不坐得进某一格"的客观事实，
 * 而不是 usableFor 那种意图标记。
 */
describe("口径（scope）", () => {
  const window = promotionWindow(dateOnly(2016, 9, 1), 2026);
  const counted = item({ promotionCategoryId: "pc_5_1", year: 2025 });
  const notCounted = item({ promotionCategoryId: null, year: 2025 });
  const outOfWindow = item({ promotionCategoryId: "pc_5_1", year: 2026 });
  const perfOnly = item({ promotionCategoryId: null, perfCategory: { majorCategory: "教师发展" } });
  const neither = item({ promotionCategoryId: null, perfCategory: null });

  it("parseScope 默认职称口径——产品决定放在读 URL 这一层", () => {
    expect(parseScope(null)).toBe("promotion");
    expect(parseScope("")).toBe("promotion");
    expect(parseScope("乱填")).toBe("promotion");
    expect(parseScope("performance")).toBe("performance");
    expect(parseScope("all")).toBe("all");
  });

  it("matchesFilters 不传 scope 时放行一切——纯函数不替产品做默认", () => {
    expect(matchesFilters(notCounted, {})).toBe(true);
  });

  it("职称口径只留挂上了指标的", () => {
    expect(matchesFilters(counted, { scope: "promotion", window })).toBe(true);
    expect(matchesFilters(notCounted, { scope: "promotion", window })).toBe(false);
  });

  it("职称口径卡时间窗：申报年度当年的不算（附件2 说明第 2 条）", () => {
    expect(matchesFilters(outOfWindow, { scope: "promotion", window })).toBe(false);
  });

  it("绩效口径看的是绩效分类，跟职称指标无关", () => {
    expect(matchesFilters(perfOnly, { scope: "performance" })).toBe(true);
    expect(matchesFilters(neither, { scope: "performance" })).toBe(false);
    // 两边都挂得上的成果，两个口径里都在——这不是互斥分区
    expect(matchesFilters(counted, { scope: "performance" })).toBe(true);
    expect(matchesFilters(counted, { scope: "promotion", window })).toBe(true);
  });

  it("全部口径连两边都挂不上的也留着——那是查漏用的", () => {
    expect(matchesFilters(neither, { scope: "all" })).toBe(true);
  });

  it("排除理由要分得开，界面得说清楚藏了什么", () => {
    expect(promotionExclusion(notCounted, window)).toBe("notCounted");
    expect(promotionExclusion(outOfWindow, window)).toBe("outOfWindow");
    expect(promotionExclusion(counted, window)).toBe(null);
  });

  it("按理由统计被挡下的条数", () => {
    const counts = promotionExclusionCounts([counted, notCounted, outOfWindow, perfOnly], window);
    expect(counts).toEqual({ notCounted: 2, outOfWindow: 1 });
  });

  it("档案没填任现职日期时不卡下限，只卡上限", () => {
    const noSince = promotionWindow(null, 2026);
    expect(matchesFilters(item({ promotionCategoryId: "x", year: 1999 }), {
      scope: "promotion",
      window: noSince,
    })).toBe(true);
  });
});

describe("sumPromotionScore", () => {
  it("与申报分是两套口径的分，各算各的", () => {
    const rows = [
      { promotionScore: 4, declaredScore: 10 },
      { promotionScore: 1.2, declaredScore: 5 },
      { promotionScore: null, declaredScore: 3 },
    ];
    expect(sumPromotionScore(rows)).toBeCloseTo(5.2);
    expect(sumDeclaredScore(rows)).toBe(18);
  });

  it("扣分项是负数，照样加进去（说明第 8 条：扣分不设下限）", () => {
    expect(sumPromotionScore([{ promotionScore: 2 }, { promotionScore: -3 }])).toBe(-1);
  });
});

describe("填了职称分却没挂指标", () => {
  it("只填分不挂指标 —— 标出来", () => {
    expect(
      hasScoreWithoutCategory({ promotionCategoryId: null, promotionScore: 4 }),
    ).toBe(true);
  });

  it("挂了指标就不算，哪怕分还没填", () => {
    expect(hasScoreWithoutCategory({ promotionCategoryId: "pc1", promotionScore: null })).toBe(
      false,
    );
    expect(hasScoreWithoutCategory({ promotionCategoryId: "pc1", promotionScore: 4 })).toBe(false);
  });

  it("两个都没填是正常状态，不提示", () => {
    expect(hasScoreWithoutCategory({ promotionCategoryId: null, promotionScore: null })).toBe(
      false,
    );
  });

  // 0 分是有意义的值（有些指标就是记 0），不能当没填
  it("分数为 0 也算填了", () => {
    expect(hasScoreWithoutCategory({ promotionCategoryId: null, promotionScore: 0 })).toBe(true);
  });

  it("计数", () => {
    expect(
      scoreWithoutCategoryCount([
        { promotionCategoryId: null, promotionScore: 4 },
        { promotionCategoryId: null, promotionScore: null },
        { promotionCategoryId: "pc1", promotionScore: 2 },
        { promotionCategoryId: null, promotionScore: 1.5 },
      ]),
    ).toBe(2);
  });

  // 这批被职称口径挡在外面的理由是"未挂指标"——填了分并不改变这一点。
  // 两个函数各说各的：一个说"为什么进不来"，一个说"这条其实是想进来的"
  it("填了分仍然算 notCounted，口径过滤不看分数", () => {
    const filled = item({ promotionCategoryId: null });
    expect(promotionExclusion(filled, null)).toBe("notCounted");
  });
});

/**
 * 小类分面。用户点名要的「纵向课题/横向课题/论文/发明专利」都在这一层——
 * 它们早就在 PerfCategory 表里，只是界面上从没摆出来过。
 */
describe("minorFacets · 绩效小类", () => {
  const rows = [
    item({ perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "纵向课题（教科研）" } }),
    item({ perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "纵向课题（教科研）" } }),
    item({ perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "普通期刊发表" } }),
    item({ perfCategory: { majorCategory: "教师发展", minorCategory: "教师综合性荣誉" } }),
    item({ perfCategory: null }),
  ];

  // 82 个小类一次全摆出来等于没筛，所以不选大类就不给小类
  it("不传大类时返回空", () => {
    expect(minorFacets(rows, null)).toEqual([]);
    expect(minorFacets(rows, undefined)).toEqual([]);
  });

  it("只统计选定大类下的小类", () => {
    expect(minorFacets(rows, "科研与社会服务工作")).toEqual([
      { value: "纵向课题（教科研）", count: 2 },
      { value: "普通期刊发表", count: 1 },
    ]);
  });

  it("按条数降序——本人只用到 82 个里的一小半，按原顺序排会让空小类占位置", () => {
    const facets = minorFacets(rows, "科研与社会服务工作");
    expect(facets[0].count).toBeGreaterThanOrEqual(facets[1].count);
  });

  it("没挂绩效分类的不计入", () => {
    expect(minorFacets(rows, "教师发展")).toEqual([
      { value: "教师综合性荣誉", count: 1 },
    ]);
  });
});

describe("promotionMinorFacets · 职称二级指标", () => {
  const rows = [
    item({ promotionCategoryId: "a", promotionCategory: { majorIndicator: "教育教学", code: "4.10", minorIndicator: "指导学生" } }),
    item({ promotionCategoryId: "b", promotionCategory: { majorIndicator: "教育教学", code: "4.5", minorIndicator: "指导学生获奖" } }),
    item({ promotionCategoryId: "c", promotionCategory: { majorIndicator: "教育教学", code: "4.5", minorIndicator: "指导学生获奖" } }),
    item({ promotionCategoryId: "d", promotionCategory: { majorIndicator: "科研成果及业绩", code: "5.2", minorIndicator: "纵向课题" } }),
  ];

  // 4.10 必须排在 4.5 之后，字符串排序会排反
  it("按编号排序，不按条数", () => {
    expect(promotionMinorFacets(rows, "教育教学").map((f) => f.value)).toEqual(["4.5", "4.10"]);
  });

  it("带上二级指标名给界面显示", () => {
    expect(promotionMinorFacets(rows, "教育教学")[0]).toMatchObject({
      value: "4.5",
      label: "指导学生获奖",
      count: 2,
    });
  });

  it("不传一级指标时返回空", () => {
    expect(promotionMinorFacets(rows, null)).toEqual([]);
  });
});

describe("按小类筛选", () => {
  const paper = item({
    perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "普通期刊发表" },
  });
  const project = item({
    perfCategory: { majorCategory: "科研与社会服务工作", minorCategory: "纵向课题（教科研）" },
  });

  it("小类精确匹配", () => {
    expect(matchesFilters(paper, { minor: "普通期刊发表" })).toBe(true);
    expect(matchesFilters(project, { minor: "普通期刊发表" })).toBe(false);
  });

  it("大类与小类同时生效", () => {
    expect(
      matchesFilters(paper, { major: "科研与社会服务工作", minor: "普通期刊发表" }),
    ).toBe(true);
    expect(matchesFilters(paper, { major: "教师发展", minor: "普通期刊发表" })).toBe(false);
  });

  it("职称二级指标按编号筛", () => {
    const row = item({
      promotionCategoryId: "a",
      promotionCategory: { majorIndicator: "科研成果及业绩", code: "5.2" },
    });
    expect(matchesFilters(row, { promotionMinor: "5.2" })).toBe(true);
    expect(matchesFilters(row, { promotionMinor: "5.3" })).toBe(false);
  });
});
