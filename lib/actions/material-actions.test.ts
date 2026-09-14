import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FORM_STATE } from "@/lib/form-state";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  linkFindUnique: vi.fn(),
  linkUpdate: vi.fn(),
  requirementFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  achievementFindUnique: vi.fn(),
  achievementDelete: vi.fn(),
  transaction: vi.fn(),
  attachmentFindUnique: vi.fn(),
  attachmentCreate: vi.fn(),
  requirementAttachmentCreate: vi.fn(),
  activityCreate: vi.fn(),
  saveUpload: vi.fn(),
  deleteUpload: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/storage", () => ({
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
  isAllowedUpload: vi.fn(() => true),
  projectScope: vi.fn((id: string) => `projects/${id}`),
  achievementScope: vi.fn((id: string) => `achievements/${id}`),
  saveUpload: mocks.saveUpload,
  deleteUpload: mocks.deleteUpload,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    requirement: { findUnique: mocks.requirementFindUnique },
    achievement: { findUnique: mocks.achievementFindUnique },
    attachment: {
      findUnique: mocks.attachmentFindUnique,
      create: mocks.attachmentCreate,
    },
    requirementAttachment: {
      findUnique: mocks.linkFindUnique,
      update: mocks.linkUpdate,
      create: mocks.requirementAttachmentCreate,
    },
    $transaction: mocks.transaction,
    activityLog: { create: mocks.activityCreate },
  },
}));

import { uploadRequirementReport } from "@/lib/actions/attachment-actions";
import {
  linkRequirementMaterial,
  setRequirementMaterialQualified,
} from "@/lib/actions/material-actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function uploadForm(filename: string, legacyAchievementId?: string): FormData {
  const data = new FormData();
  data.set(
    "file",
    new File(["report body"], filename, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  data.set("note", "终稿");
  if (legacyAchievementId) data.set("legacyAchievementId", legacyAchievementId);
  return data;
}

function eligibleLegacy(overrides: Record<string, unknown> = {}) {
  return {
    type: "REPORT",
    perfCategoryId: null,
    promotionCategoryId: null,
    usableFor: ["PROJECT_CLOSING"],
    attachments: [],
    links: [
      {
        id: "legacy-link",
        requirementId: "requirement-1",
        isQualified: true,
        qualifiedAt: new Date("2026-07-20T03:00:00.000Z"),
        qualifyNote: "报告已完成",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.linkFindUnique.mockResolvedValue({
    requirement: { projectId: "project-1" },
  });
  mocks.linkUpdate.mockResolvedValue({ id: "link-1" });
  mocks.requirementFindUnique.mockResolvedValue({ projectId: "project-1" });
  mocks.projectFindUnique.mockResolvedValue({ id: "project-1" });
  mocks.attachmentFindUnique.mockResolvedValue({
    projectId: "project-1",
    filename: "课题材料.pdf",
  });
  mocks.achievementFindUnique.mockResolvedValue(null);
  mocks.saveUpload.mockResolvedValue({
    storagePath: "projects/project-1/report.docx",
    size: 12,
  });
  mocks.attachmentCreate.mockResolvedValue({ id: "attachment-1" });
  mocks.requirementAttachmentCreate.mockResolvedValue({ id: "material-link-1" });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      attachment: { create: mocks.attachmentCreate },
      requirementAttachment: { create: mocks.requirementAttachmentCreate },
      achievement: { delete: mocks.achievementDelete },
    }),
  );
});

describe("linkRequirementMaterial", () => {
  it("个人常用文档被拒绝且不创建 RequirementAttachment", async () => {
    mocks.attachmentFindUnique.mockResolvedValue({
      projectId: null,
      filename: "课程标准.pdf",
    });

    const state = await linkRequirementMaterial(
      "project-1",
      IDLE_FORM_STATE,
      form({
        requirementId: "requirement-1",
        attachmentId: "personal-document-1",
        note: "私人参考",
      }),
    );

    expect(state).toEqual({
      ok: false,
      message: "这不是当前课题的课题材料，不能直接关联要求项",
    });
    expect(mocks.attachmentFindUnique).toHaveBeenCalledWith({
      where: { id: "personal-document-1" },
      select: { projectId: true, filename: true },
    });
    expect(mocks.requirementAttachmentCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setRequirementMaterialQualified", () => {
  it("修改前先验会话", async () => {
    await setRequirementMaterialQualified(
      "project-1",
      IDLE_FORM_STATE,
      form({ linkId: "link-1", isQualified: "on", qualifyNote: "已核对" }),
    );

    expect(mocks.requireSession).toHaveBeenCalledOnce();
  });

  it("修改前核对材料挂接属于 URL 上的课题", async () => {
    mocks.linkFindUnique.mockResolvedValue({
      requirement: { projectId: "other-project" },
    });

    const state = await setRequirementMaterialQualified(
      "project-1",
      IDLE_FORM_STATE,
      form({ linkId: "link-1", isQualified: "on", qualifyNote: "已核对" }),
    );

    expect(state).toEqual({ ok: false, message: "找不到这条课题材料关联" });
    expect(mocks.linkUpdate).not.toHaveBeenCalled();
  });

  it("勾选后保存时间和人工说明", async () => {
    await setRequirementMaterialQualified(
      "project-1",
      IDLE_FORM_STATE,
      form({ linkId: "link-1", isQualified: "on", qualifyNote: "报告已完成" }),
    );

    expect(mocks.linkUpdate).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: {
        isQualified: true,
        qualifiedAt: expect.any(Date),
        qualifyNote: "报告已完成",
      },
    });
  });

  it("取消达标时清空确认时间但保留用户填写的说明", async () => {
    await setRequirementMaterialQualified(
      "project-1",
      IDLE_FORM_STATE,
      form({ linkId: "link-1", qualifyNote: "等待修订" }),
    );

    expect(mocks.linkUpdate).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: {
        isQualified: false,
        qualifiedAt: null,
        qualifyNote: "等待修订",
      },
    });
  });
});

describe("uploadRequirementReport", () => {
  it("结题报告入口强制使用 FINAL_REPORT 并直接关联要求", async () => {
    const state = await uploadRequirementReport(
      "project-1",
      "requirement-1",
      IDLE_FORM_STATE,
      uploadForm("report.docx"),
    );

    expect(mocks.attachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        achievementId: null,
        kind: "FINAL_REPORT",
        filename: "report.docx",
      }),
      select: { id: true },
    });
    expect(mocks.requirementAttachmentCreate).toHaveBeenCalledWith({
      data: {
        requirementId: "requirement-1",
        attachmentId: "attachment-1",
      },
    });
    expect(state).toMatchObject({
      ok: true,
      message: "已上传并关联结题报告 report.docx",
    });
  });

  it("跨课题要求在写磁盘前被拒绝", async () => {
    mocks.requirementFindUnique.mockResolvedValue({ projectId: "other-project" });

    const state = await uploadRequirementReport(
      "project-1",
      "requirement-1",
      IDLE_FORM_STATE,
      uploadForm("report.docx"),
    );

    expect(state).toEqual({ ok: false, message: "找不到这条结题要求项" });
    expect(mocks.saveUpload).not.toHaveBeenCalled();
  });

  it("数据库事务失败时删除刚落盘的文件", async () => {
    mocks.transaction.mockRejectedValue(new Error("database failed"));

    await expect(
      uploadRequirementReport(
        "project-1",
        "requirement-1",
        IDLE_FORM_STATE,
        uploadForm("report.docx"),
      ),
    ).rejects.toThrow("database failed");

    expect(mocks.deleteUpload).toHaveBeenCalledWith("projects/project-1/report.docx");
  });
});

describe("uploadRequirementReport · 迁移旧结题报告", () => {
  it("保留人工达标状态并删除旧成果", async () => {
    mocks.achievementFindUnique.mockResolvedValue(eligibleLegacy());

    const state = await uploadRequirementReport(
      "project-1",
      "requirement-1",
      IDLE_FORM_STATE,
      uploadForm("report.docx", "legacy-report"),
    );

    expect(mocks.requirementAttachmentCreate).toHaveBeenCalledWith({
      data: {
        requirementId: "requirement-1",
        attachmentId: "attachment-1",
        isQualified: true,
        qualifiedAt: new Date("2026-07-20T03:00:00.000Z"),
        qualifyNote: "报告已完成",
      },
    });
    expect(mocks.achievementDelete).toHaveBeenCalledWith({
      where: { id: "legacy-report" },
    });
    expect(state).toMatchObject({
      ok: true,
      message: "已迁为课题结题材料 report.docx",
    });
  });

  it.each([
    ["带绩效分类", { perfCategoryId: "performance-1" }],
    ["带职称分类", { promotionCategoryId: "promotion-1" }],
    ["还有其他用途", { usableFor: ["PROJECT_CLOSING", "PERFORMANCE"] }],
    [
      "挂到多个要求",
      {
        links: [
          ...eligibleLegacy().links,
          {
            id: "legacy-link-2",
            requirementId: "requirement-2",
            isQualified: false,
            qualifiedAt: null,
            qualifyNote: null,
          },
        ],
      },
    ],
    ["已有成果附件", { attachments: [{ id: "old-file" }] }],
    [
      "挂在另一个要求",
      {
        links: [
          {
            ...eligibleLegacy().links[0],
            requirementId: "requirement-2",
          },
        ],
      },
    ],
  ])("%s 时拒绝自动迁移且不写磁盘", async (_label, overrides) => {
    mocks.achievementFindUnique.mockResolvedValue(eligibleLegacy(overrides));

    const state = await uploadRequirementReport(
      "project-1",
      "requirement-1",
      IDLE_FORM_STATE,
      uploadForm("report.docx", "legacy-report"),
    );

    expect(state).toEqual({
      ok: false,
      message: "这条研究报告不符合自动迁移条件，请保留为独立成果",
    });
    expect(mocks.saveUpload).not.toHaveBeenCalled();
    expect(mocks.achievementDelete).not.toHaveBeenCalled();
  });
});
