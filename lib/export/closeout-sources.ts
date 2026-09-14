import "server-only";
import { prisma } from "@/lib/db";
import { calcProjectGap } from "@/lib/gap";
import { buildMaterialZipPlan } from "./materials-zip";
import { loadProjectMaterialSources } from "./material-sources";
import type { CloseoutInput } from "./closeout";

/**
 * 装载生成结题清单要的一切（增量 3.2）。
 *
 * **材料编号与材料 ZIP 共用同一份规划**：两处各查各的、各编各的号，
 * 清单上写着「材料 1-2」而包里叫别的名，交上去就对不上。
 */
export async function loadCloseoutInput(
  projectId: string,
  now: Date = new Date(),
  client: typeof prisma = prisma,
): Promise<CloseoutInput | null> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      shortTitle: true,
      code: true,
      level: true,
      category: true,
      fundingType: true,
      status: true,
      role: true,
      ownerOrder: true,
      memberCount: true,
      hostUnit: true,
      archivedAt: true,
      applyDeadline: true,
      startDate: true,
      endDate: true,
      closingDeadline: true,
      source: { select: { name: true } },
      requirements: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          rawText: true,
          requiredCount: true,
          dueDate: true,
          links: {
            orderBy: { createdAt: "asc" },
            select: {
              isQualified: true,
              qualifyNote: true,
              achievementId: true,
              achievement: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  level: true,
                  publishedAt: true,
                  completedAt: true,
                  datePrecision: true,
                  dateText: true,
                },
              },
            },
          },
          materials: {
            // RequirementAttachment 的写入口已拒绝个人文档；导出再按课题 owner 收窄，
            // 即使出现历史或库外写入的异常连接，也不能进入结题清单 Word。
            where: { attachment: { projectId } },
            orderBy: { createdAt: "asc" },
            select: { attachmentId: true, note: true, isQualified: true },
          },
        },
      },
    },
  });
  if (!project) return null;

  const materialSources = await loadProjectMaterialSources(projectId, client);
  const materialPlan = buildMaterialZipPlan({
    projectMaterials: materialSources?.projectMaterials ?? [],
    achievementEvidence: materialSources?.achievementEvidence ?? [],
    selectedIds: null,
  });

  // 缺口只在 lib/gap.ts 算一处，这里不重算（CLAUDE.md 第 6 条）
  const gap = calcProjectGap(
    {
      status: project.status,
      archivedAt: project.archivedAt,
      applyDeadline: project.applyDeadline,
      closingDeadline: project.closingDeadline,
      requirements: project.requirements.map((requirement) => ({
        id: requirement.id,
        requiredCount: requirement.requiredCount,
        links: requirement.links.map((link) => ({
          achievementId: link.achievementId,
          isQualified: link.isQualified,
        })),
        materials: requirement.materials.map((material) => ({
          attachmentId: material.attachmentId,
          isQualified: material.isQualified,
        })),
      })),
    },
    now,
  );

  const profile = await client.profile.findFirst({ select: { name: true, unit: true } });

  return {
    project: {
      title: project.title,
      shortTitle: project.shortTitle,
      code: project.code,
      level: project.level,
      category: project.category,
      fundingType: project.fundingType,
      status: project.status,
      role: project.role,
      ownerOrder: project.ownerOrder,
      memberCount: project.memberCount,
      hostUnit: project.hostUnit,
      sourceName: project.source?.name ?? null,
      startDate: project.startDate,
      endDate: project.endDate,
      closingDeadline: project.closingDeadline,
      requirements: project.requirements.map((requirement) => ({
        id: requirement.id,
        rawText: requirement.rawText,
        requiredCount: requirement.requiredCount,
        dueDate: requirement.dueDate,
        links: requirement.links.map((link) => ({
          isQualified: link.isQualified,
          qualifyNote: link.qualifyNote,
          achievement: link.achievement,
        })),
        materials: requirement.materials,
      })),
    },
    gap,
    materialPlan,
    profile,
    generatedAt: now,
  };
}
