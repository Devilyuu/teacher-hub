import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { loadDeclarationExportSources } from "./sources";

function attachmentRow(
  id: string,
  achievementId: string | null,
  projectId: string | null,
  kind: string,
) {
  return {
    id,
    achievementId,
    projectId,
    kind,
    filename: `${id}.pdf`,
    storagePath: `2026/${id}`,
    size: 10,
    uploadedAt: new Date("2026-03-01T00:00:00.000Z"),
  };
}

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
        // 两次调用：先按 id 查成果挂的指标，再按年度取当前那版表的封顶规则
        findMany: vi.fn().mockImplementation(async (args: { where: { year?: number } }) =>
          args.where.year === 2026
            ? [
                {
                  code: "5.1",
                  majorIndicator: "科研能力",
                  minorIndicator: "论文",
                  majorCap: { toString: () => "50" },
                  cap: { toString: () => "10" },
                  capGroup: "5.1",
                },
              ]
            : [
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
              ],
        ),
      },
      promotionRuleset: {
        findFirst: vi.fn().mockResolvedValue({ year: 2026 }),
      },
      attachment: {
        findMany: vi.fn().mockResolvedValue([
          attachmentRow("f-paper", "achievement-1", null, "PUBLICATION"),
          attachmentRow("f-approval", null, "project-1", "APPROVAL"),
          attachmentRow("f-final", null, "project-1", "FINAL_REPORT"),
          // 研究参考不是本课题的产出：不计「材料份数」，也不进申报包
          attachmentRow("f-reference", null, "project-1", "REFERENCE"),
        ]),
      },
      profile: {
        findFirst: vi.fn().mockResolvedValue({
          name: "张三",
          unit: "设计学院",
          currentTitleSince: new Date(Date.UTC(2020, 8, 1)),
        }),
      },
    };

    const loaded = await loadDeclarationExportSources(db as never);

    expect(achievementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
    // 封顶规则和成果在同一个客户端（导出时是同一个事务）里读，Decimal 转成数
    expect(db.promotionRuleset.findFirst).toHaveBeenCalledWith({
      orderBy: { year: "desc" },
      select: { year: true },
    });
    expect(loaded.capRules).toEqual([
      {
        code: "5.1",
        majorIndicator: "科研能力",
        minorIndicator: "论文",
        majorCap: 50,
        cap: 10,
        capGroup: "5.1",
      },
    ]);
    // 任现职日期是职称表时间窗的起点，页面预检和导出接口都从这里拿
    expect(loaded.profile).toEqual({
      name: "张三",
      unit: "设计学院",
      currentTitleSince: new Date(Date.UTC(2020, 8, 1)),
    });
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

    // 申报包 ZIP 的材料和「材料份数」出自同一份筛过的列表：课题 3 份附件里研究参考不算，
    // 两条绩效事项没有自己的附件，各自挂它所属课题的那 2 份
    const ids = (key: string) => loaded.materials.get(key)?.map((material) => material.id);
    expect(ids("ACHIEVEMENT:achievement-1")).toEqual(["f-paper"]);
    expect(ids("PROJECT:project-1")).toEqual(["f-approval", "f-final"]);
    expect(ids("PROJECT_EVENT:event-apply")).toEqual(["f-approval", "f-final"]);
    expect(ids("PROJECT_EVENT:event-closeout")).toEqual(["f-approval", "f-final"]);
    expect(loaded.materials.get("PROJECT:project-1")?.[0]).toEqual({
      id: "f-approval",
      kind: "APPROVAL",
      filename: "f-approval.pdf",
      storagePath: "2026/f-approval",
      size: 10,
      uploadedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
  });
});
