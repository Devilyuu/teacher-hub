import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  missingYearCount,
  outcomeScopeCounts,
  performanceMajorFacets,
  performanceMinorFacets,
  promotionMajorFacets,
  promotionMinorFacets,
  promotionScoreComposition,
  PROMOTION_SCORE_UNCATEGORIZED,
  scoreWithoutPromotionCategoryCount,
  typeFacets,
  usageFacets,
  yearFacets,
} from "@/lib/outcomes/facets";
import { promotionWindow } from "@/lib/promotion";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";

function project(
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "PROJECT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "PROJECT" }> {
  return {
    key: "PROJECT:project-1",
    kind: "PROJECT",
    id: "project-1",
    title: "省级课题",
    href: "/projects/project-1",
    level: "PROVINCIAL",
    promotionYear: 2025,
    promotionCategory: {
      code: "5.2",
      majorIndicator: "科研成果及业绩",
      minorIndicator: "纵向课题",
    },
    promotionScore: 6,
    performanceEntries: [
      {
        id: "event-1",
        year: 2026,
        isVerified: true,
        declaredScore: 8,
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "纵向课题",
        },
      },
    ],
    schoolRewarded: false,
    attachmentCount: 1,
    projectStatus: "ONGOING",
    ...overrides,
  };
}

function achievement(
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }> {
  return {
    key: "ACHIEVEMENT:achievement-1",
    kind: "ACHIEVEMENT",
    id: "achievement-1",
    title: "论文",
    href: "/achievements/achievement-1",
    level: "PROVINCIAL",
    promotionYear: 2025,
    promotionCategory: {
      code: "5.1",
      majorIndicator: "科研成果及业绩",
      minorIndicator: "论文",
    },
    promotionScore: 4,
    performanceEntries: [
      {
        id: "achievement-1",
        year: 2025,
        isVerified: false,
        declaredScore: 10,
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "论文",
        },
      },
    ],
    schoolRewarded: false,
    attachmentCount: 1,
    achievementType: "PAPER",
    achievementStatus: "PUBLISHED",
    isVerified: false,
    usableFor: ["PERFORMANCE"],
    needsLink: false,
    linkedProjects: [],
    tags: [],
    year: 2025,
    perfCategoryId: "perf-paper",
    promotionCategoryId: "promotion-paper",
    declaredScore: 10,
    publishedAt: null,
    completedAt: null,
    datePrecision: "YEAR",
    dateText: "2025 年",
    ...overrides,
  };
}

describe("unified outcome facets", () => {
  it("counts one project once per performance year, major, and minor facet", () => {
    const repeatedProject = project({
      performanceEntries: [
        {
          id: "event-1",
          year: 2026,
          isVerified: true,
          declaredScore: 4,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "event-2",
          year: 2026,
          isVerified: false,
          declaredScore: 5,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
      ],
    });

    expect(yearFacets([repeatedProject], { scope: "performance" })).toEqual([
      { value: 2026, count: 1 },
    ]);
    expect(
      performanceMajorFacets([repeatedProject], { scope: "performance" }),
    ).toEqual([{ value: "科研与社会服务工作", count: 1 }]);
    expect(
      performanceMinorFacets(
        [repeatedProject],
        { scope: "performance" },
        "科研与社会服务工作",
      ),
    ).toEqual([{ value: "纵向课题", count: 1 }]);
  });

  it("counts promotion facets by rows and preserves indicator order", () => {
    const rows = [
      project(),
      achievement({
        key: "ACHIEVEMENT:a-2",
        id: "a-2",
        promotionCategory: {
          code: "4.5",
          majorIndicator: "教育教学",
          minorIndicator: "指导学生获奖",
        },
      }),
      achievement({
        key: "ACHIEVEMENT:a-3",
        id: "a-3",
        promotionCategory: {
          code: "4.10",
          majorIndicator: "教育教学",
          minorIndicator: "课程建设",
        },
      }),
    ];

    expect(
      promotionMajorFacets(rows, { scope: "promotion" }, [
        "教育教学",
        "科研成果及业绩",
      ]),
    ).toEqual([
      { value: "教育教学", count: 2 },
      { value: "科研成果及业绩", count: 1 },
    ]);
    expect(
      promotionMinorFacets(rows, { scope: "promotion" }, "教育教学").map(
        (facet) => facet.value,
      ),
    ).toEqual(["4.5", "4.10"]);
  });

  it("only counts achievement usage while usage filtering keeps projects", () => {
    expect(
      usageFacets([
        project(),
        achievement({ usableFor: ["PERFORMANCE", "PROJECT_CLOSING"] }),
      ], { scope: "all" }),
    ).toEqual([
      { value: "PERFORMANCE", count: 1 },
      { value: "PROMOTION", count: 0 },
      { value: "PROJECT_CLOSING", count: 1 },
    ]);
  });

  it("uses the selected scope coordinate for missing-year facets", () => {
    const missingPromotion = project({
      key: "PROJECT:missing-promotion",
      id: "missing-promotion",
      promotionYear: null,
      performanceEntries: [
        {
          ...project().performanceEntries[0],
          year: 2026,
        },
      ],
    });
    const missingPerformance = achievement({
      key: "ACHIEVEMENT:missing-performance",
      id: "missing-performance",
      promotionYear: 2025,
      performanceEntries: [
        {
          ...achievement().performanceEntries[0],
          year: null,
        },
      ],
    });

    expect(
      missingYearCount([missingPromotion, missingPerformance], {
        scope: "promotion",
        window: promotionWindow(dateOnly(2020, 1, 1), 2027),
      }),
    ).toBe(1);
    expect(
      missingYearCount([missingPromotion, missingPerformance], {
        scope: "performance",
      }),
    ).toBe(1);
    expect(
      missingYearCount([missingPromotion, missingPerformance], { scope: "all" }),
    ).toBe(2);
  });

  it("counts scope membership and scores without promotion categories", () => {
    const rows = [
      project(),
      project({
        key: "PROJECT:perf-only",
        id: "perf-only",
        promotionCategory: null,
        promotionScore: 3,
      }),
      achievement({
        key: "ACHIEVEMENT:uncategorized",
        id: "uncategorized",
        promotionCategory: null,
        promotionScore: null,
        performanceEntries: [],
      }),
    ];
    const window = promotionWindow(dateOnly(2020, 1, 1), 2027);

    expect(outcomeScopeCounts(rows, window)).toEqual({
      promotion: 1,
      performance: 2,
      all: 3,
    });
    expect(scoreWithoutPromotionCategoryCount(rows)).toBe(1);
  });

  it("orders type facets by the enum, hides empty types, and puts projects first", () => {
    const rows = [
      achievement({ key: "ACHIEVEMENT:a1", id: "a1", achievementType: "PATENT" }),
      achievement({ key: "ACHIEVEMENT:a2", id: "a2", achievementType: "PAPER" }),
      achievement({ key: "ACHIEVEMENT:a3", id: "a3", achievementType: "PAPER" }),
      project(),
    ];

    expect(typeFacets(rows, { scope: "all" })).toEqual([
      { value: "PROJECT", count: 1 },
      { value: "PAPER", count: 2 },
      { value: "PATENT", count: 1 },
    ]);
  });

  it("keeps the selected type visible at zero and follows scope and year", () => {
    const rows = [
      achievement({
        key: "ACHIEVEMENT:a1",
        id: "a1",
        achievementType: "PAPER",
        promotionYear: 2025,
      }),
    ];

    // 选中的类型在当前年度下 0 条也要留着，否则筛选还生效却没有 chip 高亮
    expect(typeFacets(rows, { scope: "promotion", year: 2024 }, "PAPER")).toEqual([
      { value: "PAPER", count: 0 },
    ]);
    expect(typeFacets(rows, { scope: "promotion", year: 2025 }, "PAPER")).toEqual([
      { value: "PAPER", count: 1 },
    ]);
  });
});

/**
 * 用户实测反馈（2026-07-31）：成果页选了 2026 年，底下的绩效大类还是所有年份的
 * 一长串，点进去是空的。分面必须跟着年度走——除了年度分面自己。
 */
describe("年度分面联动", () => {
  /** 一条 2025 立项、2026 结题的课题，两年挂在不同绩效大类下 */
  const acrossYears = project({
    key: "PROJECT:across",
    id: "across",
    promotionYear: 2025,
    performanceEntries: [
      {
        id: "e-2025",
        year: 2025,
        isVerified: true,
        declaredScore: 3,
        perfCategory: { majorCategory: "教师发展", minorCategory: "立项" },
      },
      {
        id: "e-2026",
        year: 2026,
        isVerified: true,
        declaredScore: 8,
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "结题",
        },
      },
    ],
  });

  it("选中年度后，绩效大类只数该年度的事项", () => {
    const context = { scope: "performance" as const, year: 2026 };
    expect(performanceMajorFacets([acrossYears], context)).toEqual([
      { value: "科研与社会服务工作", count: 1 },
    ]);
    expect(
      performanceMajorFacets([acrossYears], { scope: "performance" as const, year: 2025 }),
    ).toEqual([{ value: "教师发展", count: 1 }]);
  });

  it("不选年度时仍然数全部年份", () => {
    expect(
      performanceMajorFacets([acrossYears], { scope: "performance" as const }).map(
        (facet) => facet.value,
      ),
    ).toEqual(["教师发展", "科研与社会服务工作"]);
  });

  it("绩效小类同样跟着年度走", () => {
    expect(
      performanceMinorFacets(
        [acrossYears],
        { scope: "performance" as const, year: 2026 },
        "科研与社会服务工作",
      ),
    ).toEqual([{ value: "结题", count: 1 }]);
    // 2026 下「教师发展」一条都没有，不该再冒出它的小类
    expect(
      performanceMinorFacets(
        [acrossYears],
        { scope: "performance" as const, year: 2026 },
        "教师发展",
      ),
    ).toEqual([]);
  });

  /**
   * 年度分面**不能**套自己那一维，否则选中 2026 之后别的年份全消失，
   * 用户再也切不回去，只能清空全部筛选。
   */
  it("年度分面自己不套年度筛选", () => {
    const context = { scope: "performance" as const, year: 2026 };
    expect(yearFacets([acrossYears], context).map((facet) => facet.value)).toEqual([
      2026, 2025,
    ]);
  });

  /**
   * 职称口径按 promotionYear 对年度，和绩效那条完全独立
   * （CLAUDE.md 第 11 条：两张分类表是两套坐标系）。
   */
  it("职称指标按 promotionYear 而不是绩效事项的年度", () => {
    const order = ["科研成果及业绩"];
    // 这条课题的 promotionYear 是 2025，绩效事项里有 2026——
    // 选 2026 时职称指标不该算上它
    expect(
      promotionMajorFacets([acrossYears], { scope: "all" as const, year: 2026 }, order),
    ).toEqual([]);
    expect(
      promotionMajorFacets([acrossYears], { scope: "all" as const, year: 2025 }, order),
    ).toEqual([{ value: "科研成果及业绩", count: 1 }]);
  });

  /**
   * 选中的大类在新年度下是 0 条时**不能整个消失**：
   * 筛选还生效着，界面上却没有任何 chip 高亮，用户看到空列表却不知道为什么。
   */
  it("选中的分类即使当年为 0 也留着，计数显示 0", () => {
    const context = { scope: "performance" as const, year: 2026 };
    expect(performanceMajorFacets([acrossYears], context, "教师发展")).toEqual([
      { value: "科研与社会服务工作", count: 1 },
      { value: "教师发展", count: 0 },
    ]);
  });

  it("选中的分类本来就在列表里时不重复追加", () => {
    const context = { scope: "performance" as const, year: 2026 };
    expect(
      performanceMajorFacets([acrossYears], context, "科研与社会服务工作"),
    ).toEqual([{ value: "科研与社会服务工作", count: 1 }]);
  });

  it("用途分面也跟着年度走", () => {
    const paper2025 = achievement({ usableFor: ["PERFORMANCE"] });
    const counts = (year: number) =>
      Object.fromEntries(
        usageFacets([paper2025], { scope: "performance" as const, year }).map((facet) => [
          facet.value,
          facet.count,
        ]),
      );

    expect(counts(2025).PERFORMANCE).toBe(1);
    expect(counts(2026).PERFORMANCE).toBe(0);
  });

  describe("promotionScoreComposition", () => {
    it("按一级指标聚合正分，顺序跟字典表，未挂指标垫底", () => {
      const order = ["师德师风与出勤", "教学工作", "科研成果及业绩"];
      const rows = [
        achievement({ key: "ACHIEVEMENT:a1", promotionScore: 4 }), // 科研成果及业绩
        achievement({
          key: "ACHIEVEMENT:a2",
          promotionScore: 1.5,
          promotionCategory: {
            code: "2.3",
            majorIndicator: "教学工作",
            minorIndicator: "教学竞赛获奖",
          },
        }),
        achievement({
          key: "ACHIEVEMENT:a3",
          promotionScore: 2,
          promotionCategory: null,
        }),
        project({ key: "PROJECT:p1", promotionScore: 6 }), // 科研成果及业绩
      ];
      expect(promotionScoreComposition(rows, order)).toEqual({
        slices: [
          { major: "教学工作", score: 1.5 },
          { major: "科研成果及业绩", score: 10 },
          { major: PROMOTION_SCORE_UNCATEGORIZED, score: 2 },
        ],
        deducted: 0,
      });
    });

    it("扣分不进条，单独带出去；零分和没填分的行不出现", () => {
      const rows = [
        achievement({ key: "ACHIEVEMENT:a1", promotionScore: 4 }),
        // 说明第 8 条：扣分不设下限
        achievement({ key: "ACHIEVEMENT:a2", promotionScore: -3 }),
        achievement({ key: "ACHIEVEMENT:a3", promotionScore: 0 }),
        achievement({ key: "ACHIEVEMENT:a4", promotionScore: null }),
      ];
      expect(promotionScoreComposition(rows, ["科研成果及业绩"])).toEqual({
        slices: [{ major: "科研成果及业绩", score: 4 }],
        deducted: -3,
      });
    });
  });
});
