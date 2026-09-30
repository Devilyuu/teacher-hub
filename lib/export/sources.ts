import "server-only";

import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ACHIEVEMENT_TYPE_LABELS,
  formatRoleWithRank,
  LEVEL_LABELS,
} from "@/lib/labels";
import { PROJECT_PERFORMANCE_EVENT_LABELS } from "@/lib/project-performance";
import type { PromotionCapRule } from "@/lib/promotion";
import {
  declarationSourceKey,
  isDeclarationMaterial,
  type DeclarationMaterial,
} from "./declaration-materials";
import { loadPromotionCapRules } from "@/lib/queries/promotion-categories";
import type { DeclarationExportInputItem, DeclarationExportProfile } from "./fingerprint";

const achievementExportSelect = {
  id: true,
  title: true,
  year: true,
  isVerified: true,
  status: true,
  level: true,
  type: true,
  ownerRole: true,
  authorPosition: true,
  dateText: true,
  declaredScore: true,
  promotionScore: true,
  perfCategoryId: true,
  promotionCategoryId: true,
} satisfies Prisma.AchievementSelect;

const projectExportSelect = {
  id: true,
  title: true,
  shortTitle: true,
  startDate: true,
  status: true,
  level: true,
  role: true,
  ownerOrder: true,
  memberCount: true,
  dateText: true,
  promotionCategoryId: true,
  promotionScore: true,
} satisfies Prisma.ProjectSelect;

const projectEventExportSelect = {
  id: true,
  projectId: true,
  kind: true,
  year: true,
  dateText: true,
  isVerified: true,
  perfCategoryId: true,
  declaredScore: true,
} satisfies Prisma.ProjectPerformanceEventSelect;

type AchievementExportRecord = Prisma.AchievementGetPayload<{
  select: typeof achievementExportSelect;
}>;

type ProjectExportRecord = Prisma.ProjectGetPayload<{
  select: typeof projectExportSelect;
}>;

type ProjectEventExportRecord = Prisma.ProjectPerformanceEventGetPayload<{
  select: typeof projectEventExportSelect;
}>;

type PerfCategoryExport = {
  majorCategory: string;
  minorCategory: string;
};

type PromotionCategoryExport = {
  code: string;
  majorIndicator: string;
  minorIndicator: string;
};

function numberOrNull(value: { toString(): string } | number | null): number | null {
  return value == null ? null : Number(value);
}

function adaptAchievement(
  row: AchievementExportRecord,
  schoolRewarded: boolean,
  attachmentCount: number,
  perfCategory: PerfCategoryExport | null,
  promotionCategory: PromotionCategoryExport | null,
): DeclarationExportInputItem {
  return {
    id: row.id,
    sourceKind: "ACHIEVEMENT",
    sourceId: row.id,
    href: `/achievements/${row.id}`,
    schoolRewarded,
    title: row.title,
    year: row.year,
    isVerified: row.isVerified,
    status: row.status,
    level: LEVEL_LABELS[row.level],
    type: ACHIEVEMENT_TYPE_LABELS[row.type],
    ownerRole: row.ownerRole,
    authorPosition: row.authorPosition,
    dateText: row.dateText,
    attachmentCount,
    perfCategoryId: row.perfCategoryId,
    promotionCategoryId: row.promotionCategoryId,
    perfCategory,
    promotionCategory,
    declaredScore: numberOrNull(row.declaredScore),
    promotionScore: numberOrNull(row.promotionScore),
  };
}

function projectRole(row: ProjectExportRecord): string {
  return formatRoleWithRank(row.role, row.ownerOrder, row.memberCount);
}

function adaptProject(
  row: ProjectExportRecord,
  schoolRewarded: boolean,
  attachmentCount: number,
  promotionCategory: PromotionCategoryExport | null,
): DeclarationExportInputItem {
  return {
    id: row.id,
    sourceKind: "PROJECT",
    sourceId: row.id,
    href: `/projects/${row.id}`,
    schoolRewarded,
    title: row.title,
    year: row.startDate?.getUTCFullYear() ?? null,
    // 课题没有独立核实字段；人工挂职称分类就是本增量的纳入决定。
    isVerified: true,
    status: row.status,
    level: LEVEL_LABELS[row.level],
    type: "课题",
    ownerRole: projectRole(row),
    authorPosition: null,
    dateText: row.dateText,
    attachmentCount,
    perfCategoryId: null,
    promotionCategoryId: row.promotionCategoryId,
    perfCategory: null,
    promotionCategory,
    declaredScore: null,
    promotionScore: numberOrNull(row.promotionScore),
  };
}

function adaptProjectEvents(
  row: ProjectExportRecord,
  events: ProjectEventExportRecord[],
  schoolRewarded: boolean,
  attachmentCount: number,
  perfCategories: ReadonlyMap<string, PerfCategoryExport>,
): DeclarationExportInputItem[] {
  const displayTitle = row.shortTitle ?? row.title;
  const ownerRole = projectRole(row);

  return events.map((event) => ({
    id: event.id,
    sourceKind: "PROJECT_EVENT",
    sourceId: event.id,
    href: `/projects/${row.id}`,
    schoolRewarded,
    title: `${displayTitle} · ${PROJECT_PERFORMANCE_EVENT_LABELS[event.kind]}`,
    year: event.year,
    isVerified: event.isVerified,
    status: row.status,
    level: LEVEL_LABELS[row.level],
    type: "课题绩效事项",
    ownerRole,
    authorPosition: null,
    dateText: event.dateText,
    attachmentCount,
    perfCategoryId: event.perfCategoryId,
    promotionCategoryId: null,
    perfCategory:
      event.perfCategoryId == null
        ? null
        : (perfCategories.get(event.perfCategoryId) ?? null),
    promotionCategory: null,
    declaredScore: numberOrNull(event.declaredScore),
    promotionScore: null,
  }));
}

export type DeclarationExportSources = {
  items: DeclarationExportInputItem[];
  profile: DeclarationExportProfile;
  /** 当前那版职称量化表的封顶规则，职称包算封顶后合计用 */
  capRules: PromotionCapRule[];
  /**
   * 每个申报候选（`declarationSourceKey`）能附上的支撑材料，申报包 ZIP 用。
   * 条数就是该候选的 `attachmentCount`——两者出自同一份筛过的列表
   */
  materials: ReadonlyMap<string, readonly DeclarationMaterial[]>;
};

/**
 * 导出页和 POST 共用的唯一数据库入口。调用者可以传事务客户端，
 * 便于集成验证在回滚事务里检查真实 Prisma 行的适配结果。
 */
export async function loadDeclarationExportSources(
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DeclarationExportSources> {
  // 事务客户端上并发 query 会让 node-postgres 在同一连接执行重叠请求；
  // 顺序读取也保证集成验证能在未提交事务中稳定看到自己的 fixture。
  const achievements = await db.achievement.findMany({
    where: { archivedAt: null },
    orderBy: [
      { year: { sort: "desc", nulls: "last" } },
      { title: "asc" },
      { id: "asc" },
    ],
    select: achievementExportSelect,
  });
  const projects = await db.project.findMany({
    orderBy: [{ startDate: "desc" }, { title: "asc" }, { id: "asc" }],
    select: projectExportSelect,
  });
  const projectEvents = await db.projectPerformanceEvent.findMany({
    where: { projectId: { in: projects.map((project) => project.id) } },
    orderBy: [{ year: "desc" }, { id: "asc" }],
    select: projectEventExportSelect,
  });
  const rewardDecisions = await db.schoolRewardDecision.findMany({
    select: { achievementId: true, projectId: true },
  });
  const perfCategoryIds = [
    ...achievements.flatMap((achievement) =>
      achievement.perfCategoryId == null ? [] : [achievement.perfCategoryId],
    ),
    ...projectEvents.flatMap((event) =>
      event.perfCategoryId == null ? [] : [event.perfCategoryId],
    ),
  ];
  const perfCategories = await db.perfCategory.findMany({
    where: { id: { in: [...new Set(perfCategoryIds)] } },
    select: { id: true, majorCategory: true, minorCategory: true },
  });
  const promotionCategoryIds = [
    ...achievements.flatMap((achievement) =>
      achievement.promotionCategoryId == null
        ? []
        : [achievement.promotionCategoryId],
    ),
    ...projects.flatMap((project) =>
      project.promotionCategoryId == null ? [] : [project.promotionCategoryId],
    ),
  ];
  const promotionCategories = await db.promotionCategory.findMany({
    where: { id: { in: [...new Set(promotionCategoryIds)] } },
    select: {
      id: true,
      code: true,
      majorIndicator: true,
      minorIndicator: true,
    },
  });
  const attachments = await db.attachment.findMany({
    where: {
      OR: [
        { achievementId: { in: achievements.map((achievement) => achievement.id) } },
        { projectId: { in: projects.map((project) => project.id) } },
      ],
    },
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      achievementId: true,
      projectId: true,
      kind: true,
      filename: true,
      storagePath: true,
      size: true,
      uploadedAt: true,
    },
  });
  const profile = await db.profile.findFirst({
    select: { name: true, unit: true, currentTitleSince: true },
  });
  const capRules = await loadPromotionCapRules(db);
  const rewardedAchievementIds = new Set(
    rewardDecisions.flatMap((decision) =>
      decision.achievementId == null ? [] : [decision.achievementId],
    ),
  );
  const rewardedProjectIds = new Set(
    rewardDecisions.flatMap((decision) =>
      decision.projectId == null ? [] : [decision.projectId],
    ),
  );
  const eventsByProject = new Map<string, ProjectEventExportRecord[]>();
  for (const event of projectEvents) {
    const existing = eventsByProject.get(event.projectId) ?? [];
    existing.push(event);
    eventsByProject.set(event.projectId, existing);
  }
  const perfCategoryById = new Map(
    perfCategories.map(({ id, ...category }) => [id, category]),
  );
  const promotionCategoryById = new Map(
    promotionCategories.map(({ id, ...category }) => [id, category]),
  );
  // 「材料份数」和申报包 ZIP 里的文件必须是同一批：两边都只数能拿去申报的材料
  // （研究参考不算，isDeclarationMaterial），表上写 2 份、包里就是 2 份
  const achievementMaterials = new Map<string, DeclarationMaterial[]>();
  const projectMaterials = new Map<string, DeclarationMaterial[]>();
  for (const attachment of attachments) {
    if (!isDeclarationMaterial(attachment.kind)) continue;
    const material: DeclarationMaterial = {
      id: attachment.id,
      kind: attachment.kind,
      filename: attachment.filename,
      storagePath: attachment.storagePath,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt,
    };
    const owner =
      attachment.achievementId != null
        ? { map: achievementMaterials, id: attachment.achievementId }
        : attachment.projectId != null
          ? { map: projectMaterials, id: attachment.projectId }
          : null;
    if (owner == null) continue;
    const rows = owner.map.get(owner.id) ?? [];
    rows.push(material);
    owner.map.set(owner.id, rows);
  }
  const achievementAttachmentCounts = new Map(
    [...achievementMaterials].map(([id, rows]) => [id, rows.length]),
  );
  const projectAttachmentCounts = new Map(
    [...projectMaterials].map(([id, rows]) => [id, rows.length]),
  );

  // 每个申报候选对应哪几份材料。课题绩效事项没有自己的附件，收它所属课题的
  const materials = new Map<string, DeclarationMaterial[]>();
  for (const achievement of achievements) {
    const rows = achievementMaterials.get(achievement.id);
    if (rows) materials.set(declarationSourceKey("ACHIEVEMENT", achievement.id), rows);
  }
  for (const project of projects) {
    const rows = projectMaterials.get(project.id);
    if (!rows) continue;
    materials.set(declarationSourceKey("PROJECT", project.id), rows);
    for (const event of eventsByProject.get(project.id) ?? []) {
      materials.set(declarationSourceKey("PROJECT_EVENT", event.id), rows);
    }
  }

  return {
    items: [
      ...achievements.map((achievement) =>
        adaptAchievement(
          achievement,
          rewardedAchievementIds.has(achievement.id),
          achievementAttachmentCounts.get(achievement.id) ?? 0,
          achievement.perfCategoryId == null
            ? null
            : (perfCategoryById.get(achievement.perfCategoryId) ?? null),
          achievement.promotionCategoryId == null
            ? null
            : (promotionCategoryById.get(achievement.promotionCategoryId) ?? null),
        ),
      ),
      ...projects.map((project) =>
        adaptProject(
          project,
          rewardedProjectIds.has(project.id),
          projectAttachmentCounts.get(project.id) ?? 0,
          project.promotionCategoryId == null
            ? null
            : (promotionCategoryById.get(project.promotionCategoryId) ?? null),
        ),
      ),
      ...projects.flatMap((project) =>
        adaptProjectEvents(
          project,
          eventsByProject.get(project.id) ?? [],
          rewardedProjectIds.has(project.id),
          projectAttachmentCounts.get(project.id) ?? 0,
          perfCategoryById,
        ),
      ),
    ],
    profile: {
      name: profile?.name ?? "",
      unit: profile?.unit ?? "",
      currentTitleSince: profile?.currentTitleSince ?? null,
    },
    capRules,
    materials,
  };
}
