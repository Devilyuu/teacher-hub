import "server-only";

import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  AchievementOutcomeRow,
  PerformanceEntry,
  ProjectOutcomeRow,
  UnifiedOutcomeRow,
} from "@/lib/outcomes/types";

const projectOutcomeBaseSelect = {
  id: true,
  title: true,
  shortTitle: true,
  level: true,
  status: true,
  startDate: true,
  promotionScore: true,
  promotionCategoryId: true,
} satisfies Prisma.ProjectSelect;

const achievementOutcomeBaseSelect = {
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
} satisfies Prisma.AchievementSelect;

const projectEventOutcomeSelect = {
  id: true,
  projectId: true,
  year: true,
  isVerified: true,
  declaredScore: true,
  perfCategoryId: true,
} satisfies Prisma.ProjectPerformanceEventSelect;

type ProjectOutcomeBaseRecord = Prisma.ProjectGetPayload<{
  select: typeof projectOutcomeBaseSelect;
}>;

type AchievementOutcomeBaseRecord = Prisma.AchievementGetPayload<{
  select: typeof achievementOutcomeBaseSelect;
}>;

type ProjectEventOutcomeBaseRecord =
  Prisma.ProjectPerformanceEventGetPayload<{
    select: typeof projectEventOutcomeSelect;
  }>;

type PromotionCategoryRecord = {
  id: string;
  code: string;
  majorIndicator: string;
  minorIndicator: string;
};

type PerfCategoryRecord = {
  id: string;
  majorCategory: string;
  minorCategory: string;
};

type LinkedProjectRecord = {
  id: string;
  title: string;
  shortTitle: string | null;
};

type ProjectOutcomeRecord = ProjectOutcomeBaseRecord & {
  promotionCategory: Omit<PromotionCategoryRecord, "id"> | null;
  performanceEvents: Array<
    Omit<ProjectEventOutcomeBaseRecord, "projectId" | "perfCategoryId"> & {
      perfCategory: Omit<PerfCategoryRecord, "id"> | null;
    }
  >;
  schoolRewards: Array<{ id: string }>;
  _count: { attachments: number };
};

type AchievementOutcomeRecord = AchievementOutcomeBaseRecord & {
  promotionCategory: Omit<PromotionCategoryRecord, "id"> | null;
  perfCategory: Omit<PerfCategoryRecord, "id"> | null;
  links: Array<{ requirement: { project: LinkedProjectRecord } }>;
  schoolRewards: Array<{ id: string }>;
  _count: { attachments: number };
};

function numberOrNull(value: { toString(): string } | number | null): number | null {
  return value == null ? null : Number(value);
}

const outcomeTitleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "variant",
});

function compareStableText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function outcomeBusinessYear(row: UnifiedOutcomeRow): number | null {
  const years = [
    row.promotionYear,
    ...row.performanceEntries.map((entry) => entry.year),
  ].filter((year): year is number => year != null);
  return years.length === 0 ? null : Math.max(...years);
}

function compareOutcomeRows(a: UnifiedOutcomeRow, b: UnifiedOutcomeRow): number {
  const aYear = outcomeBusinessYear(a);
  const bYear = outcomeBusinessYear(b);
  if (aYear == null && bYear != null) return 1;
  if (aYear != null && bYear == null) return -1;
  if (aYear != null && bYear != null && aYear !== bYear) return bYear - aYear;

  return (
    outcomeTitleCollator.compare(a.title, b.title) ||
    compareStableText(a.key, b.key)
  );
}

function adaptProject(project: ProjectOutcomeRecord): ProjectOutcomeRow {
  return {
    key: `PROJECT:${project.id}`,
    kind: "PROJECT",
    id: project.id,
    title: project.title,
    href: `/projects/${project.id}`,
    level: project.level,
    promotionYear: project.startDate?.getUTCFullYear() ?? null,
    promotionCategory: project.promotionCategory,
    promotionScore: numberOrNull(project.promotionScore),
    performanceEntries: project.performanceEvents.map((event) => ({
      id: event.id,
      year: event.year,
      isVerified: event.isVerified,
      declaredScore: numberOrNull(event.declaredScore),
      perfCategory: event.perfCategory,
    })),
    schoolRewarded: project.schoolRewards.length > 0,
    attachmentCount: project._count.attachments,
    projectStatus: project.status,
  };
}

function achievementPerformanceEntries(
  achievement: AchievementOutcomeRecord,
): PerformanceEntry[] {
  if (
    achievement.year == null &&
    achievement.perfCategory == null &&
    achievement.declaredScore == null
  ) {
    return [];
  }

  return [
    {
      id: achievement.id,
      year: achievement.year,
      isVerified: achievement.isVerified,
      declaredScore: numberOrNull(achievement.declaredScore),
      perfCategory: achievement.perfCategory,
    },
  ];
}

function adaptAchievement(
  achievement: AchievementOutcomeRecord,
): AchievementOutcomeRow {
  const linkedProjects = new Map<string, string>();
  for (const link of achievement.links) {
    const project = link.requirement.project;
    linkedProjects.set(project.id, project.shortTitle ?? project.title);
  }

  return {
    key: `ACHIEVEMENT:${achievement.id}`,
    kind: "ACHIEVEMENT",
    id: achievement.id,
    title: achievement.title,
    href: `/achievements/${achievement.id}`,
    level: achievement.level,
    promotionYear: achievement.year,
    promotionCategory: achievement.promotionCategory,
    promotionScore: numberOrNull(achievement.promotionScore),
    performanceEntries: achievementPerformanceEntries(achievement),
    schoolRewarded: achievement.schoolRewards.length > 0,
    attachmentCount: achievement._count.attachments,
    achievementType: achievement.type,
    achievementStatus: achievement.status,
    isVerified: achievement.isVerified,
    usableFor: [...achievement.usableFor],
    needsLink:
      achievement.usableFor.includes("PROJECT_CLOSING") &&
      achievement.links.length === 0,
    linkedProjects: [...linkedProjects.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort(
        (a, b) =>
          outcomeTitleCollator.compare(a.name, b.name) ||
          compareStableText(a.id, b.id),
      ),
    tags: [...achievement.tags],
    year: achievement.year,
    perfCategoryId: achievement.perfCategoryId,
    promotionCategoryId: achievement.promotionCategoryId,
    declaredScore: numberOrNull(achievement.declaredScore),
    publishedAt: achievement.publishedAt,
    completedAt: achievement.completedAt,
    datePrecision: achievement.datePrecision,
    dateText: achievement.dateText,
  };
}

export async function getUnifiedOutcomeList(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UnifiedOutcomeRow[]> {
  // TransactionClient shares one PostgreSQL connection. Every read stays flat and
  // sequential: overlapping calls — including relation branches inside one rich
  // Prisma select — trigger pg's client.query warning and will be rejected by pg 9.
  const projects = await db.project.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: projectOutcomeBaseSelect,
  });
  const achievements = await db.achievement.findMany({
    where: { archivedAt: null },
    orderBy: [
      { year: { sort: "desc", nulls: "last" } },
      { updatedAt: "desc" },
      { id: "asc" },
    ],
    select: achievementOutcomeBaseSelect,
  });
  const projectEvents = await db.projectPerformanceEvent.findMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
    orderBy: [{ year: "desc" }, { id: "asc" }],
    select: projectEventOutcomeSelect,
  });
  const rewards = await db.schoolRewardDecision.findMany({
    where: {
      OR: [
        { projectId: { in: projects.map((project) => project.id) } },
        { achievementId: { in: achievements.map((achievement) => achievement.id) } },
      ],
    },
    select: { id: true, projectId: true, achievementId: true },
  });
  const promotionCategories = await db.promotionCategory.findMany({
    where: {
      id: {
        in: [
          ...projects.flatMap((project) =>
            project.promotionCategoryId == null
              ? []
              : [project.promotionCategoryId],
          ),
          ...achievements.flatMap((achievement) =>
            achievement.promotionCategoryId == null
              ? []
              : [achievement.promotionCategoryId],
          ),
        ],
      },
    },
    select: {
      id: true,
      code: true,
      majorIndicator: true,
      minorIndicator: true,
    },
  });
  const perfCategories = await db.perfCategory.findMany({
    where: {
      id: {
        in: [
          ...achievements.flatMap((achievement) =>
            achievement.perfCategoryId == null
              ? []
              : [achievement.perfCategoryId],
          ),
          ...projectEvents.flatMap((event) =>
            event.perfCategoryId == null ? [] : [event.perfCategoryId],
          ),
        ],
      },
    },
    select: { id: true, majorCategory: true, minorCategory: true },
  });
  const attachments = await db.attachment.findMany({
    where: {
      OR: [
        { projectId: { in: projects.map((project) => project.id) } },
        { achievementId: { in: achievements.map((achievement) => achievement.id) } },
      ],
    },
    select: { projectId: true, achievementId: true },
  });
  const links = await db.requirementLink.findMany({
    where: {
      achievementId: { in: achievements.map((achievement) => achievement.id) },
    },
    select: { achievementId: true, requirementId: true },
  });
  const requirements = await db.requirement.findMany({
    where: { id: { in: links.map((link) => link.requirementId) } },
    select: {
      id: true,
      project: {
        select: { id: true, title: true, shortTitle: true },
      },
    },
  });

  const promotionCategoryById = new Map(
    promotionCategories.map(({ id, ...category }) => [id, category]),
  );
  const perfCategoryById = new Map(
    perfCategories.map(({ id, ...category }) => [id, category]),
  );
  const rewardsByProject = new Map<string, Array<{ id: string }>>();
  const rewardsByAchievement = new Map<string, Array<{ id: string }>>();
  for (const reward of rewards) {
    if (reward.projectId != null) {
      const rows = rewardsByProject.get(reward.projectId) ?? [];
      rows.push({ id: reward.id });
      rewardsByProject.set(reward.projectId, rows);
    }
    if (reward.achievementId != null) {
      const rows = rewardsByAchievement.get(reward.achievementId) ?? [];
      rows.push({ id: reward.id });
      rewardsByAchievement.set(reward.achievementId, rows);
    }
  }

  const attachmentCountByProject = new Map<string, number>();
  const attachmentCountByAchievement = new Map<string, number>();
  for (const attachment of attachments) {
    if (attachment.projectId != null) {
      attachmentCountByProject.set(
        attachment.projectId,
        (attachmentCountByProject.get(attachment.projectId) ?? 0) + 1,
      );
    }
    if (attachment.achievementId != null) {
      attachmentCountByAchievement.set(
        attachment.achievementId,
        (attachmentCountByAchievement.get(attachment.achievementId) ?? 0) + 1,
      );
    }
  }

  const eventsByProject = new Map<
    string,
    ProjectOutcomeRecord["performanceEvents"]
  >();
  for (const event of projectEvents) {
    const rows = eventsByProject.get(event.projectId) ?? [];
    rows.push({
      id: event.id,
      year: event.year,
      isVerified: event.isVerified,
      declaredScore: event.declaredScore,
      perfCategory:
        event.perfCategoryId == null
          ? null
          : (perfCategoryById.get(event.perfCategoryId) ?? null),
    });
    eventsByProject.set(event.projectId, rows);
  }

  const projectByRequirementId = new Map(
    requirements.map((requirement) => [requirement.id, requirement.project]),
  );
  const linksByAchievement = new Map<
    string,
    AchievementOutcomeRecord["links"]
  >();
  for (const link of links) {
    const project = projectByRequirementId.get(link.requirementId);
    if (!project) continue;
    const rows = linksByAchievement.get(link.achievementId) ?? [];
    rows.push({ requirement: { project } });
    linksByAchievement.set(link.achievementId, rows);
  }

  const projectRows = projects.map<ProjectOutcomeRecord>((project) => ({
    ...project,
    promotionCategory:
      project.promotionCategoryId == null
        ? null
        : (promotionCategoryById.get(project.promotionCategoryId) ?? null),
    performanceEvents: eventsByProject.get(project.id) ?? [],
    schoolRewards: rewardsByProject.get(project.id) ?? [],
    _count: { attachments: attachmentCountByProject.get(project.id) ?? 0 },
  }));
  const achievementRows = achievements.map<AchievementOutcomeRecord>(
    (achievement) => ({
      ...achievement,
      promotionCategory:
        achievement.promotionCategoryId == null
          ? null
          : (promotionCategoryById.get(achievement.promotionCategoryId) ?? null),
      perfCategory:
        achievement.perfCategoryId == null
          ? null
          : (perfCategoryById.get(achievement.perfCategoryId) ?? null),
      links: linksByAchievement.get(achievement.id) ?? [],
      schoolRewards: rewardsByAchievement.get(achievement.id) ?? [],
      _count: {
        attachments: attachmentCountByAchievement.get(achievement.id) ?? 0,
      },
    }),
  );

  return [
    ...projectRows.map(adaptProject),
    ...achievementRows.map(adaptAchievement),
  ].sort(compareOutcomeRows);
}
