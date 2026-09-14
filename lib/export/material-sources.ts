import "server-only";
import { prisma } from "@/lib/db";
import type { MaterialAttachment } from "./materials-zip";

/** 两条来源分开返回，去重交给 buildMaterialZipPlan（规格 6.4） */
export type MaterialSources = {
  projectTitle: string;
  projectCode: string | null;
  projectMaterials: MaterialAttachment[];
  achievementEvidence: MaterialAttachment[];
};

const ATTACHMENT_FIELDS = {
  id: true,
  code: true,
  kind: true,
  filename: true,
  storagePath: true,
  size: true,
  uploadedAt: true,
} as const;

/**
 * 装载一个课题能打进 ZIP 的全部材料。
 *
 * 两条路各查一次（规格 6.4）：
 * 1. 课题级材料 —— `Attachment.projectId = 本课题`；
 * 2. 成果级证据 —— 经 `RequirementLink → Achievement → attachments` 到达。
 *
 * **第 2 条只收已挂接的成果**，不收「跟这个课题有点关系」的成果——
 * 挂接是唯一的关联事实，其余都是猜。是否达标不影响是否进包：
 * 打包是把材料交出去，达标与否由人判断（CLAUDE.md 第 1 条）。
 */
export async function loadProjectMaterialSources(
  projectId: string,
  client: typeof prisma = prisma,
): Promise<MaterialSources | null> {
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      shortTitle: true,
      code: true,
      attachments: {
        orderBy: [{ kind: "asc" }, { uploadedAt: "asc" }],
        select: ATTACHMENT_FIELDS,
      },
    },
  });
  if (!project) return null;

  const evidence = await client.attachment.findMany({
    where: {
      achievement: {
        links: { some: { requirement: { projectId } } },
      },
    },
    orderBy: [{ kind: "asc" }, { uploadedAt: "asc" }],
    select: ATTACHMENT_FIELDS,
  });

  return {
    projectTitle: project.shortTitle ?? project.title,
    projectCode: project.code,
    projectMaterials: project.attachments,
    achievementEvidence: evidence,
  };
}
