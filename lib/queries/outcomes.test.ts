import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { getUnifiedOutcomeList } from "@/lib/queries/outcomes";

vi.mock("@/lib/db", () => ({ prisma: {} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
}

function projectRecord(input: {
  id: string;
  title: string;
  startYear: number | null;
  performanceYears?: number[];
}) {
  return {
    id: input.id,
    title: input.title,
    level: "PROVINCIAL" as const,
    status: "ONGOING" as const,
    startDate:
      input.startYear == null
        ? null
        : new Date(Date.UTC(input.startYear, 0, 1)),
    promotionScore: null,
    promotionCategory: null,
    performanceEvents: (input.performanceYears ?? []).map((year, index) => ({
      id: `${input.id}-event-${index}`,
      year,
      isVerified: true,
      declaredScore: null,
      perfCategory: null,
    })),
    schoolRewards: [],
    _count: { attachments: 0 },
  };
}

function achievementRecord(input: {
  id: string;
  title: string;
  year: number | null;
}) {
  return {
    id: input.id,
    title: input.title,
    type: "PAPER" as const,
    status: "PUBLISHED" as const,
    level: "PROVINCIAL" as const,
    year: input.year,
    perfCategoryId: null,
    promotionCategoryId: null,
    isVerified: true,
    usableFor: [] as const,
    tags: [],
    promotionScore: null,
    declaredScore: null,
    publishedAt: null,
    completedAt: null,
    datePrecision: "UNKNOWN" as const,
    dateText: null,
    promotionCategory: null,
    perfCategory: null,
    links: [],
    schoolRewards: [],
    _count: { attachments: 0 },
  };
}

function emptyRelatedReads() {
  return {
    projectPerformanceEvent: { findMany: vi.fn().mockResolvedValue([]) },
    schoolRewardDecision: { findMany: vi.fn().mockResolvedValue([]) },
    promotionCategory: { findMany: vi.fn().mockResolvedValue([]) },
    perfCategory: { findMany: vi.fn().mockResolvedValue([]) },
    attachment: { findMany: vi.fn().mockResolvedValue([]) },
    requirementLink: { findMany: vi.fn().mockResolvedValue([]) },
    requirement: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("getUnifiedOutcomeList", () => {
  it("serializes every database read used to assemble the unified rows", async () => {
    const calls: string[] = [];
    const read = (name: string) =>
      vi.fn(async () => {
        calls.push(name);
        return [];
      });
    const db = {
      project: { findMany: read("projects") },
      achievement: { findMany: read("achievements") },
      projectPerformanceEvent: { findMany: read("events") },
      schoolRewardDecision: { findMany: read("rewards") },
      promotionCategory: { findMany: read("promotionCategories") },
      perfCategory: { findMany: read("perfCategories") },
      attachment: { findMany: read("attachments") },
      requirementLink: { findMany: read("links") },
      requirement: { findMany: read("requirements") },
    } as unknown as Prisma.TransactionClient;

    await expect(getUnifiedOutcomeList(db)).resolves.toEqual([]);
    expect(calls).toEqual([
      "projects",
      "achievements",
      "events",
      "rewards",
      "promotionCategories",
      "perfCategories",
      "attachments",
      "links",
      "requirements",
    ]);
  });

  it("reads projects before active achievements so transaction queries never overlap", async () => {
    const projects = [
      {
        id: "project-1",
        title: "省级课题",
        level: "PROVINCIAL" as const,
        status: "ONGOING" as const,
        // 上海本地时间已经是 2025 年，但 @db.Date 必须按 UTC 口径取 2024。
        startDate: new Date("2024-12-31T20:00:00.000Z"),
        dateText: "2018—2019年",
        promotionScore: new Prisma.Decimal("6.50"),
        promotionCategory: {
          code: "5.2",
          majorIndicator: "科研成果及业绩",
          minorIndicator: "纵向课题",
        },
        performanceEvents: [
          {
            id: "event-1",
            year: 2026,
            isVerified: true,
            declaredScore: new Prisma.Decimal("18.25"),
            perfCategory: {
              majorCategory: "科研与社会服务工作",
              minorCategory: "纵向课题",
            },
          },
          {
            id: "event-2",
            year: 2025,
            isVerified: false,
            declaredScore: null,
            perfCategory: null,
          },
        ],
        schoolRewards: [{ id: "reward-project" }],
        _count: { attachments: 2 },
      },
    ];
    const achievements = [
      {
        id: "achievement-1",
        title: "论文成果",
        type: "PAPER" as const,
        status: "PUBLISHED" as const,
        level: "NATIONAL" as const,
        year: 2025,
        perfCategoryId: "perf-paper",
        promotionCategoryId: "promotion-paper",
        isVerified: false,
        usableFor: ["PERFORMANCE", "PROJECT_CLOSING"] as const,
        tags: ["AI 教育", "产教融合"],
        promotionScore: new Prisma.Decimal("4.25"),
        declaredScore: new Prisma.Decimal("10.50"),
        publishedAt: new Date("2025-04-01T00:00:00.000Z"),
        completedAt: null,
        datePrecision: "MONTH" as const,
        dateText: "2025 年 4 月",
        promotionCategory: {
          code: "5.1",
          majorIndicator: "科研成果及业绩",
          minorIndicator: "论文",
        },
        perfCategory: {
          majorCategory: "科研与社会服务工作",
          minorCategory: "论文",
        },
        links: [
          {
            requirement: {
              project: {
                id: "project-1",
                title: "省级课题",
                shortTitle: "B project",
              },
            },
          },
          {
            requirement: {
              project: {
                id: "project-1",
                title: "省级课题",
                shortTitle: "B project",
              },
            },
          },
          {
            requirement: {
              project: {
                id: "project-2",
                title: "另一个课题",
                shortTitle: "A project",
              },
            },
          },
        ],
        schoolRewards: [],
        _count: { attachments: 3 },
      },
      {
        id: "achievement-2",
        title: "尚无绩效事实",
        type: "REPORT" as const,
        status: "PLANNED" as const,
        level: "UNRATED" as const,
        year: null,
        perfCategoryId: null,
        promotionCategoryId: null,
        isVerified: true,
        usableFor: [] as const,
        tags: [],
        promotionScore: null,
        declaredScore: null,
        publishedAt: null,
        completedAt: null,
        datePrecision: "UNKNOWN" as const,
        dateText: null,
        promotionCategory: null,
        perfCategory: null,
        links: [],
        schoolRewards: [{ id: "reward-achievement" }],
        _count: { attachments: 0 },
      },
      {
        id: "achievement-3",
        title: "已分类但年度待订正",
        type: "OTHER" as const,
        status: "ACCEPTED" as const,
        level: "SCHOOL" as const,
        year: null,
        perfCategoryId: "perf-course",
        promotionCategoryId: null,
        isVerified: false,
        usableFor: ["PERFORMANCE"] as const,
        tags: ["待订正"],
        promotionScore: null,
        declaredScore: null,
        publishedAt: null,
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
        datePrecision: "YEAR" as const,
        dateText: "2024 年",
        promotionCategory: null,
        perfCategory: {
          majorCategory: "教学工作",
          minorCategory: "课程建设",
        },
        links: [],
        schoolRewards: [],
        _count: { attachments: 1 },
      },
    ];

    const projectBases = projects.map((project) => ({
      id: project.id,
      title: project.title,
      shortTitle: null,
      level: project.level,
      status: project.status,
      startDate: project.startDate,
      promotionScore: project.promotionScore,
      promotionCategoryId: project.promotionCategory
        ? "promotion-project"
        : null,
    }));
    const achievementBases = achievements.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      type: achievement.type,
      status: achievement.status,
      level: achievement.level,
      year: achievement.year,
      perfCategoryId: achievement.perfCategoryId,
      promotionCategoryId: achievement.promotionCategoryId,
      isVerified: achievement.isVerified,
      usableFor: achievement.usableFor,
      tags: achievement.tags,
      promotionScore: achievement.promotionScore,
      declaredScore: achievement.declaredScore,
      publishedAt: achievement.publishedAt,
      completedAt: achievement.completedAt,
      datePrecision: achievement.datePrecision,
      dateText: achievement.dateText,
    }));
    const eventRows = projects.flatMap((project) =>
      project.performanceEvents.map(({ perfCategory, ...event }) => ({
        ...event,
        projectId: project.id,
        perfCategoryId: perfCategory ? `perf-${event.id}` : null,
      })),
    );
    const rewardRows = [
      ...projects.flatMap((project) =>
        project.schoolRewards.map((reward) => ({
          ...reward,
          projectId: project.id,
          achievementId: null,
        })),
      ),
      ...achievements.flatMap((achievement) =>
        achievement.schoolRewards.map((reward) => ({
          ...reward,
          projectId: null,
          achievementId: achievement.id,
        })),
      ),
    ];
    const promotionRows = [
      {
        id: "promotion-project",
        ...projects[0].promotionCategory!,
      },
      ...achievements.flatMap((achievement) =>
        achievement.promotionCategory
          ? [
              {
                id: achievement.promotionCategoryId!,
                ...achievement.promotionCategory,
              },
            ]
          : [],
      ),
    ];
    const perfRows = [
      ...projects.flatMap((project) =>
        project.performanceEvents.flatMap((event) =>
          event.perfCategory
            ? [{ id: `perf-${event.id}`, ...event.perfCategory }]
            : [],
        ),
      ),
      ...achievements.flatMap((achievement) =>
        achievement.perfCategoryId && achievement.perfCategory
          ? [{ id: achievement.perfCategoryId, ...achievement.perfCategory }]
          : [],
      ),
    ];
    const attachmentRows = [
      ...projects.flatMap((project) =>
        Array.from({ length: project._count.attachments }, () => ({
          projectId: project.id,
          achievementId: null,
        })),
      ),
      ...achievements.flatMap((achievement) =>
        Array.from({ length: achievement._count.attachments }, () => ({
          projectId: null,
          achievementId: achievement.id,
        })),
      ),
    ];
    const linkRows = achievements.flatMap((achievement) =>
      achievement.links.map((_, index) => ({
        achievementId: achievement.id,
        requirementId: `${achievement.id}-requirement-${index}`,
      })),
    );
    const requirementRows = achievements.flatMap((achievement) =>
      achievement.links.map((link, index) => ({
        id: `${achievement.id}-requirement-${index}`,
        project: link.requirement.project,
      })),
    );

    const projectRead = deferred<typeof projectBases>();
    const achievementRead = deferred<typeof achievementBases>();
    const projectFindMany = vi.fn(() => projectRead.promise);
    const achievementFindMany = vi.fn(() => achievementRead.promise);
    const db = {
      project: { findMany: projectFindMany },
      achievement: { findMany: achievementFindMany },
      projectPerformanceEvent: {
        findMany: vi.fn().mockResolvedValue(eventRows),
      },
      schoolRewardDecision: {
        findMany: vi.fn().mockResolvedValue(rewardRows),
      },
      promotionCategory: {
        findMany: vi.fn().mockResolvedValue(promotionRows),
      },
      perfCategory: { findMany: vi.fn().mockResolvedValue(perfRows) },
      attachment: { findMany: vi.fn().mockResolvedValue(attachmentRows) },
      requirementLink: { findMany: vi.fn().mockResolvedValue(linkRows) },
      requirement: { findMany: vi.fn().mockResolvedValue(requirementRows) },
    } as unknown as Prisma.TransactionClient;

    const pending = getUnifiedOutcomeList(db);

    expect(projectFindMany).toHaveBeenCalledOnce();
    expect(achievementFindMany).not.toHaveBeenCalled();
    expect(projectFindMany).toHaveBeenCalledWith({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        shortTitle: true,
        level: true,
        status: true,
        startDate: true,
        promotionScore: true,
        promotionCategoryId: true,
      },
    });
    projectRead.resolve(projectBases);
    await vi.waitFor(() => expect(achievementFindMany).toHaveBeenCalledOnce());
    expect(achievementFindMany).toHaveBeenCalledWith({
      where: { archivedAt: null },
      orderBy: [
        { year: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        level: true,
        year: true,
        perfCategoryId: true,
        promotionCategoryId: true,
        isVerified: true,
        usableFor: true,
        tags: true,
        promotionScore: true,
        declaredScore: true,
        publishedAt: true,
        completedAt: true,
        datePrecision: true,
        dateText: true,
      },
    });

    achievementRead.resolve(achievementBases);

    await expect(pending).resolves.toEqual([
      {
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
        promotionScore: 6.5,
        performanceEntries: [
          {
            id: "event-1",
            year: 2026,
            isVerified: true,
            declaredScore: 18.25,
            perfCategory: {
              majorCategory: "科研与社会服务工作",
              minorCategory: "纵向课题",
            },
          },
          {
            id: "event-2",
            year: 2025,
            isVerified: false,
            declaredScore: null,
            perfCategory: null,
          },
        ],
        schoolRewarded: true,
        attachmentCount: 2,
        projectStatus: "ONGOING",
      },
      {
        key: "ACHIEVEMENT:achievement-1",
        kind: "ACHIEVEMENT",
        id: "achievement-1",
        title: "论文成果",
        href: "/achievements/achievement-1",
        level: "NATIONAL",
        promotionYear: 2025,
        promotionCategory: {
          code: "5.1",
          majorIndicator: "科研成果及业绩",
          minorIndicator: "论文",
        },
        promotionScore: 4.25,
        performanceEntries: [
          {
            id: "achievement-1",
            year: 2025,
            isVerified: false,
            declaredScore: 10.5,
            perfCategory: {
              majorCategory: "科研与社会服务工作",
              minorCategory: "论文",
            },
          },
        ],
        schoolRewarded: false,
        attachmentCount: 3,
        achievementType: "PAPER",
        achievementStatus: "PUBLISHED",
        isVerified: false,
        usableFor: ["PERFORMANCE", "PROJECT_CLOSING"],
        needsLink: false,
        linkedProjects: [
          { id: "project-2", name: "A project" },
          { id: "project-1", name: "B project" },
        ],
        tags: ["AI 教育", "产教融合"],
        year: 2025,
        perfCategoryId: "perf-paper",
        promotionCategoryId: "promotion-paper",
        declaredScore: 10.5,
        publishedAt: new Date("2025-04-01T00:00:00.000Z"),
        completedAt: null,
        datePrecision: "MONTH",
        dateText: "2025 年 4 月",
      },
      {
        key: "ACHIEVEMENT:achievement-2",
        kind: "ACHIEVEMENT",
        id: "achievement-2",
        title: "尚无绩效事实",
        href: "/achievements/achievement-2",
        level: "UNRATED",
        promotionYear: null,
        promotionCategory: null,
        promotionScore: null,
        performanceEntries: [],
        schoolRewarded: true,
        attachmentCount: 0,
        achievementType: "REPORT",
        achievementStatus: "PLANNED",
        isVerified: true,
        usableFor: [],
        needsLink: false,
        linkedProjects: [],
        tags: [],
        year: null,
        perfCategoryId: null,
        promotionCategoryId: null,
        declaredScore: null,
        publishedAt: null,
        completedAt: null,
        datePrecision: "UNKNOWN",
        dateText: null,
      },
      {
        key: "ACHIEVEMENT:achievement-3",
        kind: "ACHIEVEMENT",
        id: "achievement-3",
        title: "已分类但年度待订正",
        href: "/achievements/achievement-3",
        level: "SCHOOL",
        promotionYear: null,
        promotionCategory: null,
        promotionScore: null,
        performanceEntries: [
          {
            id: "achievement-3",
            year: null,
            isVerified: false,
            declaredScore: null,
            perfCategory: {
              majorCategory: "教学工作",
              minorCategory: "课程建设",
            },
          },
        ],
        schoolRewarded: false,
        attachmentCount: 1,
        achievementType: "OTHER",
        achievementStatus: "ACCEPTED",
        isVerified: false,
        usableFor: ["PERFORMANCE"],
        needsLink: false,
        linkedProjects: [],
        tags: ["待订正"],
        year: null,
        perfCategoryId: "perf-course",
        promotionCategoryId: null,
        declaredScore: null,
        publishedAt: null,
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
        datePrecision: "YEAR",
        dateText: "2024 年",
      },
    ]);
  });

  it("does not parse a project promotion year from dateText", async () => {
    const db = {
      ...emptyRelatedReads(),
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-no-date",
            title: "只有模糊日期",
            level: "MUNICIPAL",
            status: "CLOSED",
            startDate: null,
            dateText: "2022—2024年",
            promotionScore: null,
            promotionCategory: null,
            performanceEvents: [],
            schoolRewards: [],
            _count: { attachments: 0 },
          },
        ]),
      },
      achievement: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Prisma.TransactionClient;

    const [row] = await getUnifiedOutcomeList(db);

    expect(row.promotionYear).toBeNull();
  });

  it("sorts both entity kinds by unified business year, title, then key", async () => {
    const db = {
      ...emptyRelatedReads(),
      project: {
        findMany: vi.fn().mockResolvedValue([
          projectRecord({
            id: "project-low",
            title: "Z older",
            startYear: 2024,
            performanceYears: [2025],
          }),
          projectRecord({
            id: "project-b",
            title: "B outcome",
            startYear: 2026,
          }),
        ]),
      },
      achievement: {
        findMany: vi.fn().mockResolvedValue([
          achievementRecord({
            id: "achievement-null",
            title: "A no year",
            year: null,
          }),
          achievementRecord({
            id: "achievement-a",
            title: "A outcome",
            year: 2026,
          }),
          achievementRecord({
            id: "achievement-b",
            title: "B outcome",
            year: 2026,
          }),
        ]),
      },
    } as unknown as Prisma.TransactionClient;

    const rows = await getUnifiedOutcomeList(db);

    expect(rows.map((row) => row.key)).toEqual([
      "ACHIEVEMENT:achievement-a",
      "ACHIEVEMENT:achievement-b",
      "PROJECT:project-b",
      "PROJECT:project-low",
      "ACHIEVEMENT:achievement-null",
    ]);
  });
});
