import { describe, expect, it } from "vitest";
import { DATE_UNFILLED } from "@/lib/format";
import {
  outcomeDateSubline,
  outcomeRowViewModel,
} from "@/lib/outcomes/view-model";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";

function projectRow(
  overrides: Partial<Extract<UnifiedOutcomeRow, { kind: "PROJECT" }>> = {},
): Extract<UnifiedOutcomeRow, { kind: "PROJECT" }> {
  return {
    key: "PROJECT:project/1",
    kind: "PROJECT",
    id: "project/1",
    title: "省级课题",
    href: "/projects/project/1",
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
    schoolRewarded: true,
    attachmentCount: 2,
    projectStatus: "ONGOING",
    ...overrides,
  };
}

function achievementRow(): Extract<
  UnifiedOutcomeRow,
  { kind: "ACHIEVEMENT" }
> {
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
  };
}

describe("outcomeRowViewModel", () => {
  it("builds a project detail link with an encoded outcomes return path", () => {
    const view = outcomeRowViewModel(projectRow(), {
      scope: "performance",
      currentOutcomePath: "/achievements?scope=performance&year=2026",
      filters: { year: 2026 },
    });

    expect(view.href).toBe(
      "/projects/project%2F1?returnTo=%2Fachievements%3Fscope%3Dperformance%26year%3D2026",
    );
    expect(view.entityLabel).toBe("课题");
    expect(view.performanceCount).toBe(2);
    expect(view.performanceSummary).toBe("科研与社会服务工作 · 纵向课题");
    expect(view.schoolRewarded).toBe(true);
    expect(view.quickEdit).toBeNull();
  });

  it("keeps achievement details in the current filter and exposes quick edit", () => {
    const row = achievementRow();
    row.linkedProjects = [{ id: "project/linked", name: "关联课题" }];
    const currentOutcomePath =
      "/achievements?pmajor=%E7%A7%91%E7%A0%94&unverified=1";
    const view = outcomeRowViewModel(row, {
      scope: "promotion",
      currentOutcomePath,
      filters: {},
    });

    expect(view.href).toBe(
      "/achievements/achievement-1?pmajor=%E7%A7%91%E7%A0%94&unverified=1",
    );
    expect(view.linkedProjects).toEqual([
      {
        id: "project/linked",
        name: "关联课题",
        href: `/projects/project%2Flinked?returnTo=${encodeURIComponent(currentOutcomePath)}`,
      },
    ]);
    expect(
      new URL(view.linkedProjects[0].href, "https://local.example").searchParams.get(
        "returnTo",
      ),
    ).toBe(currentOutcomePath);
    expect(view.entityLabel).toBe("成果");
    expect(view.quickEdit).toEqual({
      id: "achievement-1",
      year: 2025,
      type: "PAPER",
      status: "PUBLISHED",
      level: "PROVINCIAL",
      perfCategoryId: "perf-paper",
      promotionCategoryId: "promotion-paper",
      promotionScore: 4,
      declaredScore: 10,
      usableFor: ["PERFORMANCE"],
      isVerified: false,
    });
  });

  it("shows only the child event that satisfies all performance filters", () => {
    const splitAcrossEvents = projectRow({
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
    const matchingEvent = projectRow({
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
      ],
    });
    const options = {
      scope: "performance" as const,
      currentOutcomePath:
        "/achievements?scope=performance&unverified=1",
      filters: { unverifiedOnly: true },
    };

    expect(
      outcomeRowViewModel(splitAcrossEvents, options).performanceEntries,
    ).toEqual([]);
    expect(
      outcomeRowViewModel(matchingEvent, options).performanceEntries.map(
        (entry) => entry.id,
      ),
    ).toEqual(["categorized-unverified"]);
  });
});

describe("outcomeDateSubline", () => {
  it("只精确到年、且和年度列同一个年份时不显示——避免「2026 / 2026 年」", () => {
    expect(outcomeDateSubline("2026", "2026 年")).toBeNull();
  });

  it("比年度更精确时要显示", () => {
    expect(outcomeDateSubline("2026", "2026-04")).toBe("2026-04");
    expect(outcomeDateSubline("2026", "2026-04-18")).toBe("2026-04-18");
  });

  it("跨年区间原文要显示，哪怕年度列里有其中一年", () => {
    expect(outcomeDateSubline("2016", "2016—2017年")).toBe("2016—2017年");
  });

  it("没有日期时不显示——占位符本身不带信息", () => {
    expect(outcomeDateSubline("2026", DATE_UNFILLED)).toBeNull();
    expect(outcomeDateSubline("2026", "")).toBeNull();
    expect(outcomeDateSubline("—", "  ")).toBeNull();
  });

  it("占位符和核实徽章不许再撞词——「待确认」只归核实状态", () => {
    expect(DATE_UNFILLED).not.toBe("待确认");
  });

  it("年度列是多个年份时，单年日期仍要显示", () => {
    expect(outcomeDateSubline("2026、2025", "2026 年")).toBe("2026 年");
  });

  it("年度列为空占位时，有日期就显示", () => {
    expect(outcomeDateSubline("—", "2019 年")).toBe("2019 年");
  });
});
