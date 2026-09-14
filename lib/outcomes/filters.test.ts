import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import { promotionWindow } from "@/lib/promotion";
import {
  filterOutcomes,
  matchesOutcomeFilters,
  normalizeOutcomeFilters,
  sumPerformanceScore,
  totals,
} from "@/lib/outcomes/filters";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";

function projectRow(
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "PROJECT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "PROJECT" }> {
  return {
    key: "PROJECT:project-1",
    kind: "PROJECT",
    id: "project-1",
    title: "省级课题",
    href: "/projects/project-1",
    level: "PROVINCIAL",
    promotionYear: 2024,
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
        declaredScore: 18,
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "纵向课题",
        },
      },
    ],
    schoolRewarded: false,
    attachmentCount: 2,
    projectStatus: "ONGOING",
    ...overrides,
  };
}

function achievementRow(
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }> {
  return {
    key: "ACHIEVEMENT:achievement-1",
    kind: "ACHIEVEMENT",
    id: "achievement-1",
    title: "论文成果",
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
    usableFor: ["PERFORMANCE", "PROMOTION"],
    needsLink: false,
    linkedProjects: [],
    tags: ["AI 教育"],
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

describe("matchesOutcomeFilters", () => {
  it("uses project start year for promotion and child event year for performance", () => {
    const row = projectRow();

    expect(matchesOutcomeFilters(row, { scope: "promotion", year: 2024 })).toBe(true);
    expect(matchesOutcomeFilters(row, { scope: "performance", year: 2026 })).toBe(true);
    expect(matchesOutcomeFilters(row, { scope: "performance", year: 2024 })).toBe(false);
  });

  it("matches the missing-year coordinate selected by each scope", () => {
    const promotionMissing = projectRow({
      promotionYear: null,
      performanceEntries: [
        { ...projectRow().performanceEntries[0], year: 2026 },
      ],
    });
    const performanceMissing = achievementRow({
      promotionYear: 2025,
      performanceEntries: [
        { ...achievementRow().performanceEntries[0], year: null },
      ],
    });

    expect(
      matchesOutcomeFilters(promotionMissing, {
        scope: "promotion",
        year: "none",
        window: promotionWindow(dateOnly(2020, 1, 1), 2027),
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(performanceMissing, {
        scope: "performance",
        year: "none",
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(promotionMissing, { scope: "all", year: "none" }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(performanceMissing, { scope: "all", year: "none" }),
    ).toBe(true);
  });

  it("matches either coordinate in all scope", () => {
    const row = projectRow();

    expect(matchesOutcomeFilters(row, { scope: "all", year: 2024 })).toBe(true);
    expect(matchesOutcomeFilters(row, { scope: "all", year: 2026 })).toBe(true);
    expect(
      matchesOutcomeFilters(row, {
        scope: "all",
        major: "科研与社会服务工作",
        minor: "纵向课题",
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(row, {
        scope: "all",
        promotionMajor: "科研成果及业绩",
        promotionMinor: "5.2",
      }),
    ).toBe(true);
  });

  it("keeps PromotionWindow semantics instead of treating it as an exact year", () => {
    const window = promotionWindow(dateOnly(2025, 6, 1), 2027);

    expect(
      matchesOutcomeFilters(projectRow({ promotionYear: 2025 }), {
        scope: "promotion",
        window,
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(projectRow({ promotionYear: 2026 }), {
        scope: "promotion",
        window,
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(projectRow({ promotionYear: 2024 }), {
        scope: "promotion",
        window,
      }),
    ).toBe(false);
    expect(
      matchesOutcomeFilters(projectRow({ promotionYear: 2027 }), {
        scope: "promotion",
        window,
      }),
    ).toBe(false);
  });

  it("uses the category coordinate belonging to the selected scope", () => {
    const row = projectRow();

    expect(
      matchesOutcomeFilters(row, {
        scope: "promotion",
        promotionMajor: "科研成果及业绩",
        promotionMinor: "5.2",
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(row, {
        scope: "promotion",
        promotionMinor: "5.3",
      }),
    ).toBe(false);
    expect(
      matchesOutcomeFilters(row, {
        scope: "performance",
        major: "科研与社会服务工作",
        minor: "纵向课题",
      }),
    ).toBe(true);
    expect(
      matchesOutcomeFilters(row, {
        scope: "performance",
        major: "教学工作",
      }),
    ).toBe(false);
  });

  it("requires performance year and category to match the same child entry", () => {
    const row = projectRow({
      performanceEntries: [
        {
          id: "event-2026",
          year: 2026,
          isVerified: true,
          declaredScore: 4,
          perfCategory: {
            majorCategory: "教学工作",
            minorCategory: "课程建设",
          },
        },
        {
          id: "event-2027",
          year: 2027,
          isVerified: true,
          declaredScore: 9,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
      ],
    });

    expect(
      matchesOutcomeFilters(row, {
        scope: "performance",
        year: 2026,
        major: "科研与社会服务工作",
      }),
    ).toBe(false);
  });

  it("does not combine a categorized verified event with an uncategorized unverified event", () => {
    const row = projectRow({
      performanceEntries: [
        {
          id: "categorized-verified",
          year: 2026,
          isVerified: true,
          declaredScore: 4,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "uncategorized-unverified",
          year: 2026,
          isVerified: false,
          declaredScore: 9,
          perfCategory: null,
        },
      ],
    });
    const filters = { scope: "performance", unverifiedOnly: true } as const;

    expect(matchesOutcomeFilters(row, filters)).toBe(false);
    expect(filterOutcomes([row], filters)).toEqual([]);
    expect(totals([row], filters)).toEqual({
      count: 0,
      sumPromotionScore: 0,
      sumPerformanceScore: 0,
    });
  });

  it("uses the same categorized unverified event for row inclusion and totals", () => {
    const row = projectRow({
      performanceEntries: [
        {
          id: "categorized-unverified",
          year: 2026,
          isVerified: false,
          declaredScore: 5,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "uncategorized-verified",
          year: 2026,
          isVerified: true,
          declaredScore: 11,
          perfCategory: null,
        },
      ],
    });
    const filters = { scope: "performance", unverifiedOnly: true } as const;

    expect(matchesOutcomeFilters(row, filters)).toBe(true);
    expect(filterOutcomes([row], filters)).toEqual([row]);
    expect(totals([row], filters)).toEqual({
      count: 1,
      sumPromotionScore: 6,
      sumPerformanceScore: 5,
    });
  });

  it("does not combine children in all scope with a performance category and unverified filter", () => {
    const row = projectRow({
      performanceEntries: [
        {
          id: "categorized-verified",
          year: 2026,
          isVerified: true,
          declaredScore: 4,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "other-unverified",
          year: 2026,
          isVerified: false,
          declaredScore: 9,
          perfCategory: {
            majorCategory: "教学工作",
            minorCategory: "课程建设",
          },
        },
      ],
    });
    const filters = {
      scope: "all",
      major: "科研与社会服务工作",
      unverifiedOnly: true,
    } as const;

    expect(matchesOutcomeFilters(row, filters)).toBe(false);
    expect(totals([row], filters).count).toBe(0);
  });

  it("does not remove school-rewarded rows from the read-only list", () => {
    expect(
      matchesOutcomeFilters(projectRow({ schoolRewarded: true }), {
        scope: "performance",
        year: 2026,
      }),
    ).toBe(true);
  });

  it("applies usage and needs-link only to achievements and preserves projects", () => {
    const project = projectRow();
    const achievement = achievementRow({
      usableFor: ["PERFORMANCE"],
      needsLink: false,
    });

    expect(matchesOutcomeFilters(project, { usage: "PROJECT_CLOSING" })).toBe(true);
    expect(matchesOutcomeFilters(project, { needsLinkOnly: true })).toBe(true);
    expect(matchesOutcomeFilters(achievement, { usage: "PROJECT_CLOSING" })).toBe(false);
    expect(matchesOutcomeFilters(achievement, { needsLinkOnly: true })).toBe(false);
  });

  it("does not invent project verification and checks its child events instead", () => {
    expect(
      matchesOutcomeFilters(projectRow(), {
        scope: "performance",
        unverifiedOnly: true,
      }),
    ).toBe(false);
    expect(
      matchesOutcomeFilters(
        projectRow({
          performanceEntries: [
            {
              ...projectRow().performanceEntries[0],
              isVerified: false,
            },
          ],
        }),
        { scope: "performance", unverifiedOnly: true },
      ),
    ).toBe(true);
    expect(matchesOutcomeFilters(achievementRow(), { unverifiedOnly: true })).toBe(true);
  });

  it("handles null year, category, and score without treating them as matches", () => {
    const row = projectRow({
      promotionYear: null,
      promotionCategory: null,
      promotionScore: null,
      performanceEntries: [
        {
          id: "event-null",
          year: null,
          isVerified: false,
          declaredScore: null,
          perfCategory: null,
        },
      ],
    });

    expect(matchesOutcomeFilters(row, { scope: "promotion" })).toBe(false);
    expect(matchesOutcomeFilters(row, { scope: "performance" })).toBe(false);
    expect(matchesOutcomeFilters(row, { scope: "all" })).toBe(true);
    expect(matchesOutcomeFilters(row, { scope: "all", year: 2026 })).toBe(false);
    expect(sumPerformanceScore([row], {})).toBe(0);
  });

  it("filters the type dimension across both kinds and keeps it orthogonal to scope", () => {
    const project = projectRow();
    const paper = achievementRow();
    const patent = achievementRow({
      key: "ACHIEVEMENT:achievement-2",
      id: "achievement-2",
      achievementType: "PATENT",
    });

    expect(matchesOutcomeFilters(paper, { scope: "all", type: "PAPER" })).toBe(true);
    expect(matchesOutcomeFilters(patent, { scope: "all", type: "PAPER" })).toBe(false);
    // 课题在「类型」列里印的就是「课题」，筛选也必须能单点它
    expect(matchesOutcomeFilters(project, { scope: "all", type: "PROJECT" })).toBe(true);
    expect(matchesOutcomeFilters(paper, { scope: "all", type: "PROJECT" })).toBe(false);
    expect(matchesOutcomeFilters(project, { scope: "all", type: "PAPER" })).toBe(false);
    // 口径依然照常生效：类型对上了也不能绕过职称窗口
    expect(
      matchesOutcomeFilters(paper, {
        scope: "promotion",
        type: "PAPER",
        window: promotionWindow(dateOnly(2026, 1, 1), 2027),
      }),
    ).toBe(false);
    expect(filterOutcomes([project, paper, patent], { scope: "all", type: "PAPER" })).toEqual([
      paper,
    ]);
  });

  it("supports achievements with zero or one performance entry", () => {
    const none = achievementRow({ performanceEntries: [] });
    const one = achievementRow();

    expect(matchesOutcomeFilters(none, { scope: "performance" })).toBe(false);
    expect(matchesOutcomeFilters(one, { scope: "performance" })).toBe(true);
  });
});

describe("normalizeOutcomeFilters", () => {
  it("uses promotion-specific categories and only falls back to legacy fields", () => {
    const preferred = normalizeOutcomeFilters({
      scope: "promotion",
      major: "过期绩效大类",
      minor: "过期绩效小类",
      promotionMajor: "科研成果及业绩",
      promotionMinor: "5.2",
    });
    const legacy = normalizeOutcomeFilters({
      scope: "promotion",
      major: "科研成果及业绩",
      minor: "5.2",
    });

    expect(preferred).toMatchObject({
      scope: "promotion",
      promotionMajor: "科研成果及业绩",
      promotionMinor: "5.2",
    });
    expect(preferred.major).toBeUndefined();
    expect(preferred.minor).toBeUndefined();
    expect(legacy).toMatchObject({
      scope: "promotion",
      promotionMajor: "科研成果及业绩",
      promotionMinor: "5.2",
    });
    expect(
      matchesOutcomeFilters(projectRow(), {
        scope: "promotion",
        major: "过期绩效大类",
        promotionMajor: "科研成果及业绩",
      }),
    ).toBe(true);
  });

  it("ignores stale promotion-only categories in performance scope", () => {
    const normalized = normalizeOutcomeFilters({
      scope: "performance",
      major: "科研与社会服务工作",
      promotionMajor: "过期职称指标",
      promotionMinor: "9.9",
    });

    expect(normalized).toMatchObject({
      scope: "performance",
      major: "科研与社会服务工作",
    });
    expect(normalized.promotionMajor).toBeUndefined();
    expect(normalized.promotionMinor).toBeUndefined();
    expect(
      matchesOutcomeFilters(projectRow(), {
        scope: "performance",
        major: "科研与社会服务工作",
        promotionMajor: "过期职称指标",
      }),
    ).toBe(true);
  });

  it("keeps performance and promotion categories distinct in all scope", () => {
    const normalized = normalizeOutcomeFilters({
      scope: "all",
      major: "科研与社会服务工作",
      promotionMajor: "科研成果及业绩",
      promotionMinor: "5.2",
    });

    expect(normalized).toMatchObject({
      scope: "all",
      major: "科研与社会服务工作",
      promotionMajor: "科研成果及业绩",
      promotionMinor: "5.2",
    });
    expect(matchesOutcomeFilters(projectRow(), normalized)).toBe(true);
    expect(
      matchesOutcomeFilters(projectRow(), {
        scope: "all",
        major: "科研成果及业绩",
        promotionMajor: "科研成果及业绩",
      }),
    ).toBe(false);
  });

  it("keeps the pure filtering default as all when scope is absent", () => {
    expect(normalizeOutcomeFilters({ year: 2026 })).toMatchObject({
      scope: "all",
      year: 2026,
    });
  });
});

describe("filterOutcomes", () => {
  it("keeps one project row when multiple child events match", () => {
    const row = projectRow({
      performanceEntries: [
        projectRow().performanceEntries[0],
        {
          ...projectRow().performanceEntries[0],
          id: "event-2",
          declaredScore: 7,
        },
      ],
    });

    expect(
      filterOutcomes([row], {
        scope: "performance",
        year: 2026,
        major: "科研与社会服务工作",
      }),
    ).toEqual([row]);
  });
});

describe("outcome totals", () => {
  it("keeps uncategorized legacy scores in all scope when no performance filter is active", () => {
    const row = projectRow({
      promotionCategory: null,
      performanceEntries: [
        {
          id: "legacy-uncategorized",
          year: null,
          isVerified: false,
          declaredScore: 7,
          perfCategory: null,
        },
      ],
    });

    expect(totals([row], { scope: "all" })).toEqual({
      count: 1,
      sumPromotionScore: 6,
      sumPerformanceScore: 7,
    });
  });

  it("does not apply promotion year filters to performance children", () => {
    const row = projectRow();

    expect(
      totals([row], {
        scope: "promotion",
        year: 2024,
      }),
    ).toEqual({
      count: 1,
      sumPromotionScore: 6,
      sumPerformanceScore: 18,
    });
  });

  it("filters all-scope scores by the same performance coordinate when filters are present", () => {
    const row = projectRow({
      performanceEntries: [
        projectRow().performanceEntries[0],
        {
          id: "event-teaching",
          year: 2026,
          isVerified: true,
          declaredScore: 6,
          perfCategory: {
            majorCategory: "教学工作",
            minorCategory: "课程建设",
          },
        },
        {
          id: "event-2027",
          year: 2027,
          isVerified: true,
          declaredScore: 9,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "event-uncategorized",
          year: 2026,
          isVerified: true,
          declaredScore: 7,
          perfCategory: null,
        },
      ],
    });

    expect(
      sumPerformanceScore([row], {
        scope: "all",
        year: 2026,
        major: "科研与社会服务工作",
        minor: "纵向课题",
      }),
    ).toBe(18);
  });

  it("sums only unverified children in all scope when unverifiedOnly is active", () => {
    const row = projectRow({
      performanceEntries: [
        {
          ...projectRow().performanceEntries[0],
          id: "event-unverified",
          isVerified: false,
          declaredScore: 5,
        },
        {
          ...projectRow().performanceEntries[0],
          id: "event-verified",
          isVerified: true,
          declaredScore: 11,
        },
      ],
    });

    expect(
      totals([row], {
        scope: "all",
        year: 2026,
        unverifiedOnly: true,
      }),
    ).toEqual({
      count: 1,
      sumPromotionScore: 6,
      sumPerformanceScore: 5,
    });
  });

  it("sums only performance children matching the current performance filters", () => {
    const row = projectRow({
      performanceEntries: [
        projectRow().performanceEntries[0],
        {
          id: "event-2",
          year: 2026,
          isVerified: true,
          declaredScore: 6,
          perfCategory: {
            majorCategory: "教学工作",
            minorCategory: "课程建设",
          },
        },
        {
          id: "event-3",
          year: 2027,
          isVerified: true,
          declaredScore: 9,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
        {
          id: "event-4",
          year: 2026,
          isVerified: true,
          declaredScore: null,
          perfCategory: {
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题",
          },
        },
      ],
    });

    expect(
      sumPerformanceScore([row], {
        scope: "performance",
        year: 2026,
        major: "科研与社会服务工作",
        minor: "纵向课题",
      }),
    ).toBe(18);
    expect(
      totals([row], {
        scope: "performance",
        year: 2026,
        major: "科研与社会服务工作",
      }),
    ).toEqual({
      count: 1,
      sumPromotionScore: 6,
      sumPerformanceScore: 18,
    });
  });
});
