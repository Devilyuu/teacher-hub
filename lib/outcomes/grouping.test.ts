import { describe, expect, it } from "vitest";
import {
  filterOutcomes,
  sumPerformanceScore,
  sumPromotionScore,
  type OutcomeFilters,
} from "@/lib/outcomes/filters";
import {
  entryInGroup,
  groupOutcomes,
  outcomeGroupDimension,
  UNCATEGORIZED_GROUP_KEY,
  type OutcomeGroupOrder,
} from "@/lib/outcomes/grouping";
import type { PerformanceEntry, UnifiedOutcomeRow } from "@/lib/outcomes/types";

const ORDER: OutcomeGroupOrder = {
  performanceMajors: ["教学", "学生工作", "科研与社会服务工作"],
  performanceMinors: ["教学项目申报及获奖", "班主任零欠费", "纵向课题（教科研）", "科研表彰"],
  promotionMajors: ["教学业绩", "科研成果及业绩"],
};

function entry(
  id: string,
  major: string | null,
  minor: string | null,
  score: number | null,
  year = 2026,
): PerformanceEntry {
  return {
    id,
    year,
    isVerified: true,
    declaredScore: score,
    perfCategory:
      major == null || minor == null
        ? null
        : { majorCategory: major, minorCategory: minor },
  };
}

function achievement(
  id: string,
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "ACHIEVEMENT" }> {
  return {
    key: `ACHIEVEMENT:${id}`,
    kind: "ACHIEVEMENT",
    id,
    title: id,
    href: `/achievements/${id}`,
    level: "SCHOOL",
    promotionYear: 2026,
    promotionCategory: null,
    promotionScore: null,
    performanceEntries: [],
    schoolRewarded: false,
    attachmentCount: 0,
    achievementType: "AWARD",
    achievementStatus: "PUBLISHED",
    isVerified: true,
    usableFor: [],
    needsLink: false,
    linkedProjects: [],
    tags: [],
    year: 2026,
    perfCategoryId: null,
    promotionCategoryId: null,
    declaredScore: null,
    publishedAt: null,
    completedAt: null,
    datePrecision: "YEAR",
    dateText: null,
    ...overrides,
  };
}

function project(
  id: string,
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "PROJECT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "PROJECT" }> {
  return {
    key: `PROJECT:${id}`,
    kind: "PROJECT",
    id,
    title: id,
    href: `/projects/${id}`,
    level: "PROVINCIAL",
    promotionYear: null,
    promotionCategory: null,
    promotionScore: null,
    performanceEntries: [],
    schoolRewarded: false,
    attachmentCount: 0,
    projectStatus: "ONGOING",
    ...overrides,
  };
}

describe("outcomeGroupDimension", () => {
  it("follows the scope, drills one level per selected category, and stops at the leaf", () => {
    expect(outcomeGroupDimension({ scope: "all" })).toBe("performanceMajor");
    expect(outcomeGroupDimension({ scope: "performance", major: "教学" })).toBe(
      "performanceMinor",
    );
    expect(
      outcomeGroupDimension({ scope: "performance", major: "教学", minor: "x" }),
    ).toBeNull();
    expect(outcomeGroupDimension({ scope: "promotion" })).toBe("promotionMajor");
    expect(
      outcomeGroupDimension({ scope: "promotion", promotionMajor: "教学业绩" }),
    ).toBe("promotionMinor");
    expect(
      outcomeGroupDimension({
        scope: "promotion",
        promotionMajor: "教学业绩",
        promotionMinor: "3.1",
      }),
    ).toBeNull();
  });
});

describe("groupOutcomes · 绩效维度", () => {
  const filters: OutcomeFilters = { scope: "all", year: 2026 };
  const rows: UnifiedOutcomeRow[] = [
    achievement("科研表彰", {
      performanceEntries: [entry("e1", "科研与社会服务工作", "科研表彰", 3)],
    }),
    achievement("教学案例", {
      performanceEntries: [entry("e2", "教学", "教学项目申报及获奖", 3)],
    }),
    // 一个课题在两个大类下各有一条事项，外加一条去年的（不该被 2026 数进来）
    project("跨类课题", {
      performanceEntries: [
        entry("e3", "科研与社会服务工作", "纵向课题（教科研）", 15),
        entry("e4", "教学", "教学项目申报及获奖", 2),
        entry("e5", "科研与社会服务工作", "纵向课题（教科研）", 99, 2025),
      ],
    }),
    // 靠职称年度进「全部 + 2026」，一条绩效事项都没有
    achievement("只有职称年度"),
    achievement("旧表里的大类", {
      performanceEntries: [entry("e6", "已停用的大类", "旧小类", 1)],
    }),
    achievement("零欠费", {
      performanceEntries: [entry("e7", "学生工作", "班主任零欠费", 2)],
    }),
  ];

  it("orders groups by the school table, unknown majors after it, uncategorized last", () => {
    const groups = groupOutcomes(filterOutcomes(rows, filters), filters, ORDER)!;
    expect(groups.map((group) => group.key)).toEqual([
      "教学",
      "学生工作",
      "科研与社会服务工作",
      "已停用的大类",
      UNCATEGORIZED_GROUP_KEY,
    ]);
    expect(groups.at(-1)?.label).toBe("未挂绩效分类");
  });

  it("never drops a row: one without matching entries lands in the uncategorized group", () => {
    const filtered = filterOutcomes(rows, filters);
    const groups = groupOutcomes(filtered, filters, ORDER)!;
    const placed = new Set(groups.flatMap((group) => group.rows.map((row) => row.key)));
    expect(placed).toEqual(new Set(filtered.map((row) => row.key)));
    expect(groups.at(-1)?.rows.map((row) => row.id)).toEqual(["只有职称年度"]);
  });

  it("puts a row under every major it has an entry in, and splits its score accordingly", () => {
    const groups = groupOutcomes(filterOutcomes(rows, filters), filters, ORDER)!;
    const teaching = groups.find((group) => group.key === "教学")!;
    const research = groups.find((group) => group.key === "科研与社会服务工作")!;

    expect(teaching.rows.map((row) => row.id)).toContain("跨类课题");
    expect(research.rows.map((row) => row.id)).toContain("跨类课题");
    expect(teaching.score).toBe(3 + 2);
    // 2025 那条 99 分没被年度筛选放进来
    expect(research.score).toBe(3 + 15);
    expect(teaching.entryGroup).toEqual({ dimension: "major", value: "教学" });
  });

  it("keeps the subtotals adding up to the page total", () => {
    for (const scoped of [
      filters,
      { scope: "performance", year: 2026 },
      { scope: "all" },
      { scope: "performance", major: "科研与社会服务工作" },
    ] satisfies OutcomeFilters[]) {
      const filtered = filterOutcomes(rows, scoped);
      const groups = groupOutcomes(filtered, scoped, ORDER)!;
      expect(groups.reduce((sum, group) => sum + group.score, 0)).toBe(
        sumPerformanceScore(filtered, scoped),
      );
    }
  });

  it("clusters rows of the same minor inside a major group without reshuffling the rest", () => {
    const sameMajor: UnifiedOutcomeRow[] = [
      achievement("表彰甲", {
        performanceEntries: [entry("a", "科研与社会服务工作", "科研表彰", 1)],
      }),
      achievement("课题甲", {
        performanceEntries: [entry("b", "科研与社会服务工作", "纵向课题（教科研）", 1)],
      }),
      achievement("表彰乙", {
        performanceEntries: [entry("c", "科研与社会服务工作", "科研表彰", 1)],
      }),
    ];
    const [group] = groupOutcomes(sameMajor, { scope: "performance" }, ORDER)!;
    expect(group.rows.map((row) => row.id)).toEqual(["课题甲", "表彰甲", "表彰乙"]);
  });

  it("drills into minors once a major is selected, and gives up grouping at the leaf", () => {
    const byMajor: OutcomeFilters = {
      scope: "performance",
      major: "科研与社会服务工作",
    };
    const groups = groupOutcomes(filterOutcomes(rows, byMajor), byMajor, ORDER)!;
    expect(groups.map((group) => group.key)).toEqual([
      "纵向课题（教科研）",
      "科研表彰",
    ]);
    expect(groups[0].entryGroup).toEqual({
      dimension: "minor",
      value: "纵向课题（教科研）",
    });
    // 选了大类就不再有「未挂分类」：没分类的事项本来就进不了这份筛选
    expect(groups.some((group) => group.key === UNCATEGORIZED_GROUP_KEY)).toBe(false);

    const leaf = { ...byMajor, minor: "科研表彰" };
    expect(groupOutcomes(filterOutcomes(rows, leaf), leaf, ORDER)).toBeNull();
  });

  it("entryInGroup treats the null group as 'entries without a category' only", () => {
    const bare = entry("x", null, null, 1);
    const tagged = entry("y", "教学", "教学项目申报及获奖", 1);
    expect(entryInGroup(bare, { dimension: "major", value: null })).toBe(true);
    expect(entryInGroup(tagged, { dimension: "major", value: null })).toBe(false);
    expect(entryInGroup(bare, { dimension: "major", value: "教学" })).toBe(false);
    expect(entryInGroup(tagged, { dimension: "minor", value: "教学项目申报及获奖" })).toBe(true);
  });
});

describe("groupOutcomes · 职称维度", () => {
  const rows: UnifiedOutcomeRow[] = [
    achievement("论文", {
      promotionCategory: { code: "5.10", majorIndicator: "科研成果及业绩", minorIndicator: "论文" },
      promotionScore: 4,
    }),
    project("课题", {
      promotionYear: 2026,
      promotionCategory: { code: "5.2", majorIndicator: "科研成果及业绩", minorIndicator: "纵向课题" },
      promotionScore: 6,
    }),
    achievement("教学比赛", {
      promotionCategory: { code: "3.1", majorIndicator: "教学业绩", minorIndicator: "教学竞赛" },
      promotionScore: 5,
    }),
  ];

  it("groups by the first-level indicator in ruleset order with promotion-score subtotals", () => {
    const filters: OutcomeFilters = { scope: "promotion" };
    const filtered = filterOutcomes(rows, filters);
    const groups = groupOutcomes(filtered, filters, ORDER)!;

    expect(groups.map((group) => [group.key, group.score])).toEqual([
      ["教学业绩", 5],
      ["科研成果及业绩", 10],
    ]);
    expect(groups.every((group) => group.entryGroup == null)).toBe(true);
    expect(groups.reduce((sum, group) => sum + group.score, 0)).toBe(
      sumPromotionScore(filtered),
    );
  });

  it("orders second-level groups by indicator code, not by string compare", () => {
    const filters: OutcomeFilters = {
      scope: "promotion",
      promotionMajor: "科研成果及业绩",
    };
    const groups = groupOutcomes(filterOutcomes(rows, filters), filters, ORDER)!;
    // 字符串序会把 5.10 排到 5.2 前面
    expect(groups.map((group) => group.label)).toEqual(["5.2 纵向课题", "5.10 论文"]);
  });
});
