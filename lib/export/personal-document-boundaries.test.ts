import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildCloseoutDocument } from "./closeout";
import { loadCloseoutInput } from "./closeout-sources";
import { loadProjectMaterialSources } from "./material-sources";
import type { MaterialAttachment } from "./materials-zip";

const PROJECT_ID = "project-1";
const NOW = new Date("2026-08-02T00:00:00.000Z");

type QueryableAttachment = MaterialAttachment & {
  projectId: string | null;
  achievementId: string | null;
  docCategoryId: string | null;
  /** 这份成果附件的成果挂到了哪些课题的要求项；非成果附件为空 */
  achievementRequirementProjectIds: string[];
};

type ProjectQuery = {
  select: {
    attachments?: object;
    requirements?: {
      select: {
        materials: {
          where?: { attachment?: { projectId?: string } };
        };
      };
    };
  };
};

type AttachmentQuery = {
  where?: {
    achievement?: {
      links?: { some?: { requirement?: { projectId?: string } } };
    };
  };
};

function ownedAttachment(
  id: string,
  owner: Pick<QueryableAttachment, "projectId" | "achievementId" | "docCategoryId"> & {
    achievementRequirementProjectIds?: string[];
  },
): QueryableAttachment {
  return {
    id,
    code: null,
    kind: "OTHER",
    filename: `${id}.pdf`,
    storagePath: `fixtures/${id}.pdf`,
    size: 100,
    uploadedAt: NOW,
    achievementRequirementProjectIds: [],
    ...owner,
  };
}

function materialFields(attachment: QueryableAttachment): MaterialAttachment {
  const {
    projectId: _projectId,
    achievementId: _achievementId,
    docCategoryId: _docCategoryId,
    achievementRequirementProjectIds: _achievementRequirementProjectIds,
    ...material
  } = attachment;
  return material;
}

/**
 * 模拟 Prisma 的独立 Attachment.findMany：没有 where 就是全表候选；有成果挂接课题过滤
 * 才只保留经 RequirementLink 到达当前课题的成果附件。
 */
function achievementEvidenceRows(query: AttachmentQuery): MaterialAttachment[] {
  const projectId =
    query.where?.achievement?.links?.some?.requirement?.projectId;
  const candidates = [
    projectMaterial,
    achievementEvidence,
    personalDocument,
    crossProjectMaterial,
    crossProjectEvidence,
  ];
  const matched = projectId
    ? candidates.filter((attachment) =>
        attachment.achievementRequirementProjectIds.includes(projectId),
      )
    : candidates;
  return matched.map(materialFields);
}

const projectMaterial = ownedAttachment("project-material", {
  projectId: PROJECT_ID,
  achievementId: null,
  docCategoryId: null,
});
const personalDocument = ownedAttachment("personal-document", {
  projectId: null,
  achievementId: null,
  docCategoryId: "category-1",
});
const achievementEvidence = ownedAttachment("achievement-evidence", {
  projectId: null,
  achievementId: "achievement-1",
  docCategoryId: null,
  achievementRequirementProjectIds: [PROJECT_ID],
});
const crossProjectEvidence = ownedAttachment("cross-project-evidence", {
  projectId: null,
  achievementId: "achievement-2",
  docCategoryId: null,
  achievementRequirementProjectIds: ["project-2"],
});
const crossProjectMaterial = ownedAttachment("cross-project-material", {
  projectId: "project-2",
  achievementId: null,
  docCategoryId: null,
});

describe("个人文档的导出边界", () => {
  it("成果证据独立查询按挂接课题过滤，个人文档与他课题成果不进入材料 ZIP 数据源", async () => {
    // Project.attachments 是 Prisma 关系，不是全表：无论有没有嵌套 where，都只会返回当前课题附件。
    const projectFindUnique = vi.fn(async () => ({
      title: "边界测试课题",
      shortTitle: null,
      code: null,
      attachments: [materialFields(projectMaterial)],
    }));
    const attachmentFindMany = vi.fn(async (query: AttachmentQuery) =>
      achievementEvidenceRows(query),
    );
    const client = {
      project: { findUnique: projectFindUnique },
      attachment: { findMany: attachmentFindMany },
    } as unknown as NonNullable<Parameters<typeof loadProjectMaterialSources>[1]>;

    const sources = await loadProjectMaterialSources(PROJECT_ID, client);

    expect(attachmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          achievement: {
            links: { some: { requirement: { projectId: PROJECT_ID } } },
          },
        },
      }),
    );
    expect(sources?.projectMaterials.map((attachment) => attachment.id)).toEqual([
      "project-material",
    ]);
    expect(sources?.achievementEvidence.map((attachment) => attachment.id)).toEqual([
      "achievement-evidence",
    ]);
    expect(sources?.achievementEvidence.map((attachment) => attachment.id)).not.toContain(
      "personal-document",
    );
    expect(sources?.achievementEvidence.map((attachment) => attachment.id)).not.toContain(
      "cross-project-evidence",
    );
    expect(sources?.achievementEvidence.map((attachment) => attachment.id)).not.toContain(
      "cross-project-material",
    );
  });

  it("结题清单 source 只装载同课题 requirement material，个人文档不进入 Word", async () => {
    const projectFindUnique = vi.fn(async (query: ProjectQuery) => {
      if (query.select.requirements) {
        const materialProjectId =
          query.select.requirements.select.materials.where?.attachment?.projectId;
        // requirement.materials 确实是当前课题要求项的关系，但连接本身仍可能被库外写入
        // 指向错误 owner；to-one attachment.projectId filter 必须在这里把它们收窄。
        const materialLinks = [projectMaterial, personalDocument, crossProjectMaterial]
          .filter(
            (attachment) =>
              materialProjectId === undefined || attachment.projectId === materialProjectId,
          )
          .map((attachment) => ({
            attachmentId: attachment.id,
            note: attachment.id === personalDocument.id ? "私人参考" : "课题结题材料",
            isQualified: false,
          }));

        return {
          title: "边界测试课题",
          shortTitle: null,
          code: null,
          level: "SCHOOL",
          category: "RESEARCH",
          fundingType: "VERTICAL",
          status: "CLOSING",
          role: "LEAD",
          ownerOrder: 1,
          memberCount: 1,
          hostUnit: null,
          archivedAt: null,
          applyDeadline: null,
          startDate: null,
          endDate: null,
          closingDeadline: null,
          source: null,
          requirements: [
            {
              id: "requirement-1",
              rawText: "提交结题材料一份",
              requiredCount: 1,
              dueDate: null,
              links: [],
              materials: materialLinks,
            },
          ],
        };
      }

      // 同上，Project.attachments 的关系语义天然只返回当前课题附件。
      return {
        title: "边界测试课题",
        shortTitle: null,
        code: null,
        attachments: [materialFields(projectMaterial)],
      };
    });
    const client = {
      project: { findUnique: projectFindUnique },
      attachment: {
        findMany: vi.fn(async (query: AttachmentQuery) => achievementEvidenceRows(query)),
      },
      profile: { findFirst: vi.fn(async () => null) },
    } as unknown as NonNullable<Parameters<typeof loadCloseoutInput>[2]>;

    const input = await loadCloseoutInput(PROJECT_ID, NOW, client);

    expect(input).not.toBeNull();
    expect(input?.project.requirements[0].materials).toEqual([
      {
        attachmentId: "project-material",
        note: "课题结题材料",
        isQualified: false,
      },
    ]);
    expect(projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT_ID },
        select: expect.objectContaining({
          requirements: expect.objectContaining({
            select: expect.objectContaining({
              materials: expect.objectContaining({
                where: { attachment: { projectId: PROJECT_ID } },
              }),
            }),
          }),
        }),
      }),
    );
    expect(input?.materialPlan.entries.map((entry) => entry.attachmentId)).toEqual([
      "project-material",
      "achievement-evidence",
    ]);

    const document = buildCloseoutDocument(input!);
    expect(document.requirements[0].materials.map((material) => material.filename)).toEqual([
      "project-material.pdf",
    ]);
    expect(document.materialIndex.map((material) => material.filename)).not.toContain(
      "personal-document.pdf",
    );
    expect(document.materialIndex.map((material) => material.filename)).not.toContain(
      "cross-project-material.pdf",
    );
    expect(document.materialIndex.map((material) => material.filename)).not.toContain(
      "cross-project-evidence.pdf",
    );
  });
});
