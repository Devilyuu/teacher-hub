import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { loadDeclarationExportSources } from "./sources";

describe("loadDeclarationExportSources", () => {
  it("把活动成果、课题职称行和每条课题绩效事实适配为同一来源集合", async () => {
    const achievementFindMany = vi.fn().mockResolvedValue([
      {
        id: "achievement-1",
        title: "某篇论文",
        year: 2026,
        isVerified: true,
        status: "PUBLISHED",
        level: "PROVINCIAL",
        type: "PAPER",
        ownerRole: "第一作者",
        authorPosition: 1,
        dateText: "2026年",
        declaredScore: 3,
        promotionScore: 2,
        perfCategoryId: "perf-paper",
        promotionCategoryId: "promo-paper",
        perfCategory: { majorCategory: "科研", minorCategory: "论文" },
        promotionCategory: {
          code: "5.1",
          majorIndicator: "科研能力",
          minorIndicator: "论文",
        },
        _count: { attachments: 1 },
      },
    ]);
    const projectFindMany = vi.fn().mockResolvedValue([
      {
        id: "project-1",
        title: "省级课题",
        shortTitle: "省课题",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        status: "ONGOING",
        level: "PROVINCIAL",
        role: "LEAD",
        ownerOrder: 1,
        memberCount: 3,
        dateText: "2026—2028年",
        promotionCategoryId: "promo-project",
        promotionCategory: {
          code: "5.2",
          majorIndicator: "科研能力",
          minorIndicator: "纵向课题",
        },
        promotionScore: 4,
        _count: { attachments: 2 },
      },
    ]);
    const projectEventFindMany = vi.fn().mockResolvedValue([
      {
        id: "event-apply",
        projectId: "project-1",
        kind: "APPLY",
        year: 2026,
        dateText: "2026年3月",
        isVerified: true,
        perfCategoryId: "perf-project",
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "纵向课题（教科研）",
        },
        declaredScore: 1,
      },
      {
        id: "event-closeout",
        projectId: "project-1",
        kind: "CLOSEOUT",
        year: 2028,
        dateText: "2028年12月",
        isVerified: false,
        perfCategoryId: "perf-project",
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "纵向课题（教科研）",
        },
        declaredScore: 2,
      },
    ]);
    const db = {
      achievement: { findMany: achievementFindMany },
      project: { findMany: projectFindMany },
      projectPerformanceEvent: { findMany: projectEventFindMany },
      schoolRewardDecision: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ achievementId: null, projectId: "project-1" }]),
      },
      perfCategory: {
        findMany: vi.fn().mockResolvedValue([
          { id: "perf-paper", majorCategory: "科研", minorCategory: "论文" },
          {
            id: "perf-project",
            majorCategory: "科研与社会服务工作",
            minorCategory: "纵向课题（教科研）",
          },
        ]),
      },
      promotionCategory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "promo-paper",
            code: "5.1",
            majorIndicator: "科研能力",
            minorIndicator: "论文",
          },
          {
            id: "promo-project",
            code: "5.2",
            majorIndicator: "科研能力",
            minorIndicator: "纵向课题",
          },
        ]),
      },
      attachment: {
        findMany: vi.fn().mockResolvedValue([
          { achievementId: "achievement-1", projectId: null },
          { achievementId: null, projectId: "project-1" },
          { achievementId: null, projectId: "project-1" },
        ]),
      },
      profile: {
        findFirst: vi.fn().mockResolvedValue({ name: "张三", unit: "设计学院" }),
      },
    };

    const loaded = await loadDeclarationExportSources(db as never);

    expect(achievementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
    expect(loaded.profile).toEqual({ name: "张三", unit: "设计学院" });
    expect(loaded.items).toMatchObject([
      {
        sourceKind: "ACHIEVEMENT",
        sourceId: "achievement-1",
        href: "/achievements/achievement-1",
        schoolRewarded: false,
        attachmentCount: 1,
      },
      {
        sourceKind: "PROJECT",
        sourceId: "project-1",
        href: "/projects/project-1",
        year: 2026,
        isVerified: true,
        ownerRole: "主持 1/3",
        schoolRewarded: true,
        attachmentCount: 2,
      },
      {
        sourceKind: "PROJECT_EVENT",
        sourceId: "event-apply",
        href: "/projects/project-1",
        title: "省课题 · 申报",
        year: 2026,
        schoolRewarded: true,
        attachmentCount: 2,
      },
      {
        sourceKind: "PROJECT_EVENT",
        sourceId: "event-closeout",
        href: "/projects/project-1",
        title: "省课题 · 结题",
        year: 2028,
        schoolRewarded: true,
      },
    ]);
  });
});
