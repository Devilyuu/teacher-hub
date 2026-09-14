/**
 * 课题的服务端数据获取。
 *
 * 缺口一律在这里算好再交给页面（CLAUDE.md 第 6 条：组件里不许重算）。
 * 页面拿到的 `gap` 就是 lib/gap.ts 的输出，直接渲染即可。
 */
import { prisma } from "@/lib/db";
import { calcProjectGap, type ProjectGap } from "@/lib/gap";
import type {
  FundingType,
  Level,
  ProjectCategory,
  ProjectRole,
  ProjectStatus,
} from "@/lib/generated/prisma/enums";

/** 看板与列表共用的课题视图 */
export type ProjectSummary = {
  id: string;
  title: string;
  shortTitle: string | null;
  code: string | null;
  level: Level;
  category: ProjectCategory;
  fundingType: FundingType;
  role: ProjectRole;
  ownerOrder: number | null;
  memberCount: number | null;
  status: ProjectStatus;
  source: { id: string; name: string } | null;
  fundingReceived: string | null;
  closingDeadline: Date | null;
  applyDeadline: Date | null;
  archivedAt: Date | null;
  gap: ProjectGap;
};

/**
 * 「这条算不算历史课题」——罗盘和课题列表都靠它把在研的从归档的里分出来，
 * 口径必须只有一处。手点过归档的算，状态已结题/已终止/未获立项的也算：
 * 后者常常忘了点归档按钮，但它同样不该再占在研的视线。
 */
const ARCHIVED_STATUSES: ProjectStatus[] = ["CLOSED", "TERMINATED", "REJECTED"];

export function isArchivedProject(project: {
  archivedAt: Date | null;
  status: ProjectStatus;
}): boolean {
  return project.archivedAt != null || ARCHIVED_STATUSES.includes(project.status);
}

/** 只取算缺口需要的字段，别把整棵树拉回来 */
const summarySelect = {
  id: true,
  title: true,
  shortTitle: true,
  code: true,
  level: true,
  category: true,
  fundingType: true,
  role: true,
  ownerOrder: true,
  memberCount: true,
  status: true,
  source: { select: { id: true, name: true } },
  fundingReceived: true,
  closingDeadline: true,
  applyDeadline: true,
  archivedAt: true,
  requirements: {
    select: {
      id: true,
      requiredCount: true,
      links: { select: { achievementId: true, isQualified: true } },
      materials: { select: { attachmentId: true, isQualified: true } },
    },
    orderBy: { sortOrder: "asc" },
  },
} as const;

type RawProject = {
  id: string;
  title: string;
  shortTitle: string | null;
  code: string | null;
  level: Level;
  category: ProjectCategory;
  fundingType: FundingType;
  role: ProjectRole;
  ownerOrder: number | null;
  memberCount: number | null;
  status: ProjectStatus;
  source: { id: string; name: string } | null;
  /** Prisma 的 Decimal，交给页面前先转成字符串，免得 Decimal 实例穿到客户端组件 */
  fundingReceived: { toString(): string } | null;
  closingDeadline: Date | null;
  applyDeadline: Date | null;
  archivedAt: Date | null;
  requirements: Array<{
    id: string;
    requiredCount: number;
    links: Array<{ achievementId: string; isQualified: boolean }>;
    materials: Array<{ attachmentId: string; isQualified: boolean }>;
  }>;
};

function toSummary(project: RawProject): ProjectSummary {
  const { requirements, fundingReceived, ...rest } = project;
  return {
    ...rest,
    fundingReceived: fundingReceived?.toString() ?? null,
    gap: calcProjectGap({
      status: rest.status,
      archivedAt: rest.archivedAt,
      applyDeadline: rest.applyDeadline,
      closingDeadline: rest.closingDeadline,
      requirements,
    }),
  };
}

export async function getProjectSummaries(options?: {
  /** 默认不含已归档课题，看板与列表都不该被 27 条历史课题淹掉 */
  includeArchived?: boolean;
}): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: options?.includeArchived ? undefined : { archivedAt: null },
    select: summarySelect,
    orderBy: { createdAt: "asc" },
  });

  return projects.map(toSummary);
}

/** 立项来源单位，按常打交道的排前面 */
export async function getProjectSources() {
  return prisma.projectSource.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/** 看板顶部的四个数字（PRD 4.1） */
export type BoardStats = {
  /** 在研 + 结题准备 */
  activeCount: number;
  /** 其中还有缺口的 */
  withGapCount: number;
  /** 90 天内到期（含已逾期） */
  dueSoonCount: number;
  /** 尚未落地的成果 */
  inFlightAchievementCount: number;
};

/** 已经"落地"的成果状态，不计入在途 */
const SETTLED_STATUSES = ["PUBLISHED", "INDEXED", "REJECTED", "SHELVED"] as const;

export async function getBoardStats(projects: ProjectSummary[]): Promise<BoardStats> {
  const active = projects.filter((p) => p.status === "ONGOING" || p.status === "CLOSING");

  return {
    activeCount: active.length,
    withGapCount: active.filter((p) => p.gap.totalGap > 0).length,
    dueSoonCount: active.filter((p) => p.gap.daysLeft != null && p.gap.daysLeft <= 90).length,
    inFlightAchievementCount: await prisma.achievement.count({
      where: { status: { notIn: [...SETTLED_STATUSES] } },
    }),
  };
}

// ─── 详情页 ──────────────────────────────────────────────────────────

export type ProjectDetail = Awaited<ReturnType<typeof getProjectDetail>>;

export async function getProjectDetail(id: string) {
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      source: true,
      promotionCategory: true,
      performanceEvents: {
        orderBy: [{ year: "desc" }, { createdAt: "desc" }],
        include: { perfCategory: true },
      },
      schoolRewards: {
        orderBy: [
          { approvedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      },
      attachments: { orderBy: [{ kind: "asc" }, { uploadedAt: "desc" }] },
      members: { orderBy: { sortOrder: "asc" } },
      requirements: {
        orderBy: { sortOrder: "asc" },
        include: {
          links: {
            orderBy: { createdAt: "asc" },
            include: { achievement: true },
          },
          // 课题级材料（规格 6.4）。和 links 是两条独立的路：
          // links 指向成果，materials 指向课题自己的附件
          materials: {
            orderBy: { createdAt: "asc" },
            include: { attachment: true },
          },
        },
      },
    },
  });

  if (!project) return null;

  const gap = calcProjectGap_(project);
  const crossProjectUses = await getCrossProjectUses(project.id, project.requirements);

  return { ...project, gap, crossProjectUses };
}

/**
 * 跨课题重复使用（PRD 2.4）：本课题挂着的成果，有没有在**别的**课题上已被确认达标。
 * 一次查完所有成果，别在渲染每张卡片时挨个查。
 * 只给事实，不阻止挂接——提醒归提醒，判断归人。
 */
async function getCrossProjectUses(
  projectId: string,
  requirements: Array<{ links: Array<{ achievementId: string }> }>,
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const achievementIds = [
    ...new Set(requirements.flatMap((r) => r.links.map((l) => l.achievementId))),
  ];
  if (achievementIds.length === 0) return new Map();

  const links = await prisma.requirementLink.findMany({
    where: {
      achievementId: { in: achievementIds },
      isQualified: true,
      requirement: { projectId: { not: projectId } },
    },
    select: {
      achievementId: true,
      requirement: {
        select: { project: { select: { id: true, title: true, shortTitle: true } } },
      },
    },
  });

  const result = new Map<string, Map<string, string>>();
  for (const link of links) {
    const project = link.requirement.project;
    const bucket = result.get(link.achievementId) ?? new Map<string, string>();
    bucket.set(project.id, project.shortTitle ?? project.title);
    result.set(link.achievementId, bucket);
  }

  return new Map(
    [...result.entries()].map(([achievementId, projects]) => [
      achievementId,
      [...projects.entries()].map(([id, name]) => ({ id, name })),
    ]),
  );
}

function calcProjectGap_(project: {
  status: ProjectStatus;
  archivedAt: Date | null;
  applyDeadline: Date | null;
  closingDeadline: Date | null;
  requirements: Array<{
    id: string;
    requiredCount: number;
    links: Array<{ achievementId: string; isQualified: boolean }>;
    materials: Array<{ attachmentId: string; isQualified: boolean }>;
  }>;
}) {
  return calcProjectGap({
    status: project.status,
    archivedAt: project.archivedAt,
    applyDeadline: project.applyDeadline,
    closingDeadline: project.closingDeadline,
    requirements: project.requirements.map((r) => ({
      id: r.id,
      requiredCount: r.requiredCount,
      links: r.links.map((l) => ({ achievementId: l.achievementId, isQualified: l.isQualified })),
      materials: r.materials.map((material) => ({
        attachmentId: material.attachmentId,
        isQualified: material.isQualified,
      })),
    })),
  });
}
