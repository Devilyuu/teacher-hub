import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { Prisma } from "@/lib/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  isAllowedUpload: vi.fn(),
  projectScope: vi.fn((id: string) => `projects/${id}`),
  achievementScope: vi.fn((id: string) => `achievements/${id}`),
  personalScope: vi.fn(() => "personal-documents"),
  studentHonorScope: vi.fn((id: string) => `student-honors/${id}`),
  competitionEntryScope: vi.fn((id: string) => `competitions/${id}`),
  competitionEntryFindUnique: vi.fn(),
  saveUpload: vi.fn(),
  deleteUpload: vi.fn(),
  projectFindUnique: vi.fn(),
  achievementFindUnique: vi.fn(),
  docCategoryFindUnique: vi.fn(),
  docCategoryAggregate: vi.fn(),
  docCategoryCreate: vi.fn(),
  attachmentFindUnique: vi.fn(),
  attachmentCreate: vi.fn(),
  attachmentDelete: vi.fn(),
  transaction: vi.fn(),
  activityCreate: vi.fn(),
  transactionActivityCreate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/storage", () => ({
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
  isAllowedUpload: mocks.isAllowedUpload,
  projectScope: mocks.projectScope,
  achievementScope: mocks.achievementScope,
  personalScope: mocks.personalScope,
  studentHonorScope: mocks.studentHonorScope,
  competitionEntryScope: mocks.competitionEntryScope,
  saveUpload: mocks.saveUpload,
  deleteUpload: mocks.deleteUpload,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    achievement: { findUnique: mocks.achievementFindUnique },
    competitionEntry: { findUnique: mocks.competitionEntryFindUnique },
    docCategory: {
      findUnique: mocks.docCategoryFindUnique,
      aggregate: mocks.docCategoryAggregate,
      create: mocks.docCategoryCreate,
    },
    attachment: {
      findUnique: mocks.attachmentFindUnique,
      create: mocks.attachmentCreate,
      delete: mocks.attachmentDelete,
    },
    activityLog: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));

import {
  createDocCategory,
  deleteAttachment,
  deletePersonalAttachment,
  uploadAchievementAttachment,
  uploadCompetitionAttachment,
  uploadPersonalAttachment,
  uploadProjectAttachment,
} from "./attachment-actions";

const cleanupEventSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

afterAll(() => cleanupEventSpy.mockRestore());

function transactionClient() {
  return {
    attachment: { create: mocks.attachmentCreate },
    activityLog: { create: mocks.transactionActivityCreate },
    docCategory: {
      aggregate: mocks.docCategoryAggregate,
      create: mocks.docCategoryCreate,
    },
    requirementAttachment: { create: vi.fn() },
    achievement: { delete: vi.fn() },
  };
}

function prismaKnownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("internal database detail", {
    code,
    clientVersion: "test",
    meta,
  });
}

function pdfUploadForm(values: { categoryId?: string; kind?: string; note?: string } = {}) {
  const formData = new FormData();
  formData.set("file", new File(["%PDF"], "课程标准.pdf", { type: "application/pdf" }));
  if (values.categoryId !== undefined) formData.set("categoryId", values.categoryId);
  if (values.kind !== undefined) formData.set("kind", values.kind);
  if (values.note !== undefined) formData.set("note", values.note);
  return formData;
}

function categoryForm(name: string) {
  const formData = new FormData();
  formData.set("name", name);
  return formData;
}

function storedAttachment(
  overrides: Partial<{
    id: string;
    projectId: string | null;
    achievementId: string | null;
    docCategoryId: string | null;
    studentHonorId: string | null;
    competitionEntryId: string | null;
    storagePath: string;
    filename: string;
  }> = {},
) {
  return {
    id: "attachment-1",
    projectId: null,
    achievementId: null,
    docCategoryId: "category-1",
    studentHonorId: null,
    competitionEntryId: null,
    storagePath: "personal-documents/file.pdf",
    filename: "课程标准.pdf",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.isAllowedUpload.mockReturnValue(true);
  mocks.projectFindUnique.mockResolvedValue({ id: "project-1" });
  mocks.achievementFindUnique.mockResolvedValue({ id: "achievement-1" });
  mocks.competitionEntryFindUnique.mockResolvedValue({ id: "entry-1" });
  mocks.docCategoryFindUnique.mockResolvedValue({ id: "category-1", name: "课程标准" });
  mocks.docCategoryAggregate.mockResolvedValue({ _max: { sortOrder: 40 } });
  mocks.docCategoryCreate.mockResolvedValue({ id: "category-new" });
  mocks.saveUpload.mockImplementation(async (_file: File, scope: string) => ({
    storagePath: `${scope}/file.pdf`,
    size: 4,
  }));
  mocks.attachmentCreate.mockResolvedValue({ id: "attachment-1" });
  mocks.attachmentDelete.mockResolvedValue(storedAttachment());
  mocks.deleteUpload.mockResolvedValue(undefined);
  mocks.activityCreate.mockResolvedValue({ id: "activity-1" });
  mocks.transactionActivityCreate.mockResolvedValue({ id: "activity-transaction-1" });
  mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
});

describe("uploadPersonalAttachment", () => {
  it("在解析客户端分类前重新验证会话", async () => {
    await uploadPersonalAttachment(
      IDLE_FORM_STATE,
      pdfUploadForm({ categoryId: "category-1", note: "2026 版" }),
    );

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.requireSession).toHaveBeenCalledBefore(mocks.docCategoryFindUnique);
  });

  it("恶意或不存在的 categoryId 在落盘前被拒绝", async () => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);

    const state = await uploadPersonalAttachment(
      IDLE_FORM_STATE,
      pdfUploadForm({ categoryId: "../../projects/project-1", note: "伪造分类" }),
    );

    expect(mocks.docCategoryFindUnique).toHaveBeenCalledWith({
      where: { id: "../../projects/project-1" },
      select: { id: true, name: true },
    });
    expect(state).toEqual({
      ok: false,
      message: "文档分类不存在，请重新选择",
      fieldErrors: { categoryId: ["分类不存在"] },
    });
    expect(mocks.saveUpload).not.toHaveBeenCalled();
    expect(mocks.attachmentCreate).not.toHaveBeenCalled();
  });

  it("沿用现有文件类型白名单", async () => {
    mocks.isAllowedUpload.mockReturnValue(false);

    const state = await uploadPersonalAttachment(
      IDLE_FORM_STATE,
      pdfUploadForm({ categoryId: "category-1" }),
    );

    expect(state).toMatchObject({ ok: false, fieldErrors: { file: ["类型不支持"] } });
    expect(mocks.docCategoryFindUnique).not.toHaveBeenCalled();
    expect(mocks.saveUpload).not.toHaveBeenCalled();
  });

  it("沿用现有 25MB 文件大小上限", async () => {
    const formData = pdfUploadForm({ categoryId: "category-1" });
    const file = formData.get("file") as File;
    Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });

    const state = await uploadPersonalAttachment(IDLE_FORM_STATE, formData);

    expect(state).toMatchObject({ ok: false, fieldErrors: { file: ["文件过大"] } });
    expect(mocks.docCategoryFindUnique).not.toHaveBeenCalled();
    expect(mocks.saveUpload).not.toHaveBeenCalled();
  });

  it("使用专属存储范围，并以 OTHER 和五个互斥 owner 字段建库", async () => {
    const formData = pdfUploadForm({ categoryId: " category-1 ", note: "  2026 版  " });
    const file = formData.get("file");

    const state = await uploadPersonalAttachment(IDLE_FORM_STATE, formData);

    expect(mocks.personalScope).toHaveBeenCalledOnce();
    expect(mocks.saveUpload).toHaveBeenCalledWith(file, "personal-documents");
    expect(mocks.attachmentCreate).toHaveBeenCalledWith({
      data: {
        projectId: null,
        achievementId: null,
        docCategoryId: "category-1",
        studentHonorId: null,
        competitionEntryId: null,
        kind: "OTHER",
        filename: "课程标准.pdf",
        storagePath: "personal-documents/file.pdf",
        size: 4,
        mimeType: "application/pdf",
        note: "2026 版",
      },
      select: { id: true },
    });
    expect(state).toEqual({ ok: true, message: "已上传 课程标准.pdf" });
  });

  it("分类在校验后、创建附件前被删除时补偿删除刚落盘的文件", async () => {
    const databaseError = Object.assign(new Error("foreign key failed"), { code: "P2003" });
    mocks.attachmentCreate.mockRejectedValue(databaseError);

    await expect(
      uploadPersonalAttachment(
        IDLE_FORM_STATE,
        pdfUploadForm({ categoryId: "category-1", note: "2026 版" }),
      ),
    ).rejects.toBe(databaseError);

    expect(mocks.docCategoryFindUnique).toHaveBeenCalledOnce();
    expect(mocks.saveUpload).toHaveBeenCalledOnce();
    expect(mocks.attachmentCreate).toHaveBeenCalledOnce();
    expect(mocks.deleteUpload).toHaveBeenCalledWith("personal-documents/file.pdf");
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("成功后用 PersonalDocument 和文档编号审计，只刷新可信的 /profile", async () => {
    const state = await uploadPersonalAttachment(
      IDLE_FORM_STATE,
      pdfUploadForm({ categoryId: "category-1", note: "2026 版" }),
    );

    expect(mocks.transactionActivityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "PersonalDocument",
        entityId: "attachment-1",
        action: "上传个人常用文档",
        detail: {
          filename: "课程标准.pdf",
          categoryId: "category-1",
          categoryName: "课程标准",
          kind: "OTHER",
          size: 4,
        },
      },
    });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(state).toEqual({ ok: true, message: "已上传 课程标准.pdf" });
  });

  it("个人上传审计失败时回滚事务并补偿删除刚落盘文件", async () => {
    const auditError = new Error("activity unavailable");
    mocks.transactionActivityCreate.mockRejectedValue(auditError);

    await expect(
      uploadPersonalAttachment(
        IDLE_FORM_STATE,
        pdfUploadForm({ categoryId: "category-1", note: "2026 版" }),
      ),
    ).rejects.toBe(auditError);

    expect(mocks.attachmentCreate).toHaveBeenCalledOnce();
    expect(mocks.transactionActivityCreate).toHaveBeenCalledOnce();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(mocks.deleteUpload).toHaveBeenCalledWith("personal-documents/file.pdf");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("上传建库与文件补偿同时失败时只聚合两个安全摘要并记录白名单事件", async () => {
    const privatePath = "C:\\private\\uploads\\课程标准.pdf";
    const databaseError = Object.assign(
      new Error(`database detail for ${privatePath} and private note`),
      { code: "P2003" },
    );
    databaseError.stack = `PRIVATE_DATABASE_STACK at ${privatePath}`;
    Object.defineProperty(databaseError, "hiddenPrivateDetail", {
      value: "hidden database note",
      enumerable: false,
    });
    Object.defineProperty(databaseError, Symbol("private-database-symbol"), {
      value: "symbol database note",
      enumerable: true,
    });
    const cleanupError = Object.assign(new Error(`disk detail for ${privatePath}`), {
      code: "EIO",
    });
    cleanupError.stack = `PRIVATE_CLEANUP_STACK at ${privatePath}`;
    mocks.attachmentCreate.mockRejectedValue(databaseError);
    mocks.deleteUpload.mockRejectedValue(cleanupError);

    let caught: unknown;
    try {
      await uploadPersonalAttachment(
        IDLE_FORM_STATE,
        pdfUploadForm({ categoryId: "category-1", note: "private note" }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError & { cause?: unknown };
    expect(aggregate.errors).toEqual([
      {
        name: "AttachmentOperationFailure",
        operation: "upload-transaction",
        kind: "primary",
        code: "P2003",
      },
      {
        name: "AttachmentOperationFailure",
        operation: "upload-compensation",
        kind: "cleanup",
        code: "EIO",
      },
    ]);
    expect(aggregate.cause).toBeUndefined();
    const inspectedAggregate = inspect(aggregate, { showHidden: true, depth: null });
    expect(inspectedAggregate).not.toContain("课程标准.pdf");
    expect(inspectedAggregate).not.toContain("private note");
    expect(inspectedAggregate).not.toContain(privatePath);
    expect(inspectedAggregate).not.toContain("database detail");
    expect(inspectedAggregate).not.toContain("disk detail");
    expect(inspectedAggregate).not.toContain("PRIVATE_DATABASE_STACK");
    expect(inspectedAggregate).not.toContain("PRIVATE_CLEANUP_STACK");
    expect(inspectedAggregate).not.toContain("hidden database note");
    expect(inspectedAggregate).not.toContain("symbol database note");
    expect(cleanupEventSpy).toHaveBeenCalledOnce();
    expect(cleanupEventSpy).toHaveBeenCalledWith({
      event: "attachment_cleanup_failed",
      operation: "upload-compensation",
      storagePath: "personal-documents/file.pdf",
      errorCode: "EIO",
    });
    const serializedEvent = JSON.stringify(cleanupEventSpy.mock.calls[0]);
    expect(serializedEvent).not.toContain("课程标准.pdf");
    expect(serializedEvent).not.toContain("private note");
    expect(serializedEvent).not.toContain("database detail");
    expect(serializedEvent).not.toContain("disk detail");
    expect(serializedEvent).not.toContain(privatePath);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("四种附件 owner 互斥", () => {
  it("课题附件只写 projectId，不放宽原有上传入口", async () => {
    await uploadProjectAttachment(
      "project-1",
      IDLE_FORM_STATE,
      pdfUploadForm({ kind: "OTHER" }),
    );

    expect(mocks.attachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        achievementId: null,
        docCategoryId: null,
      }),
      select: { id: true },
    });
    expect(mocks.projectScope).toHaveBeenCalledWith("project-1");
    expect(mocks.personalScope).not.toHaveBeenCalled();
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "Project",
        entityId: "project-1",
        action: "上传附件",
        detail: { filename: "课程标准.pdf", kind: "OTHER", size: 4 },
      },
    });
    expect(mocks.transactionActivityCreate).not.toHaveBeenCalled();
  });

  it("成果附件只写 achievementId，不放宽原有上传入口", async () => {
    await uploadAchievementAttachment(
      "achievement-1",
      IDLE_FORM_STATE,
      pdfUploadForm({ kind: "OTHER" }),
    );

    expect(mocks.attachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: null,
        achievementId: "achievement-1",
        docCategoryId: null,
      }),
      select: { id: true },
    });
    expect(mocks.achievementScope).toHaveBeenCalledWith("achievement-1");
    expect(mocks.personalScope).not.toHaveBeenCalled();
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "Achievement",
        entityId: "achievement-1",
        action: "上传附件",
        detail: { filename: "课程标准.pdf", kind: "OTHER", size: 4 },
      },
    });
    expect(mocks.transactionActivityCreate).not.toHaveBeenCalled();
  });

  // 加这一条不是为了覆盖率：新归属接进来时，落盘目录和审计实体原本都是
  // 三元链兜底（`: personalScope()` 和 `: "StudentHonor"`），漏一个分支
  // 不会报错，只会把参赛材料默默存进个人文档目录、记成一条学生荣誉日志
  it("参赛材料只写 competitionEntryId，且落在自己的目录和审计实体上", async () => {
    await uploadCompetitionAttachment(
      "entry-1",
      IDLE_FORM_STATE,
      pdfUploadForm({ kind: "AWARD_CERTIFICATE" }),
    );

    expect(mocks.attachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: null,
        achievementId: null,
        docCategoryId: null,
        studentHonorId: null,
        competitionEntryId: "entry-1",
      }),
      select: { id: true },
    });
    expect(mocks.competitionEntryScope).toHaveBeenCalledWith("entry-1");
    expect(mocks.personalScope).not.toHaveBeenCalled();
    expect(mocks.studentHonorScope).not.toHaveBeenCalled();
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "CompetitionEntry",
        entityId: "entry-1",
        action: "上传附件",
        detail: { filename: "课程标准.pdf", kind: "AWARD_CERTIFICATE", size: 4 },
      },
    });
  });
});

describe("createDocCategory", () => {
  it("会话校验后 trim 名称，已有同名返回可展示错误", async () => {
    mocks.docCategoryFindUnique.mockResolvedValue({ id: "category-existing" });

    const state = await createDocCategory(IDLE_FORM_STATE, categoryForm("  课程标准  "));

    expect(mocks.requireSession).toHaveBeenCalledBefore(mocks.docCategoryFindUnique);
    expect(mocks.docCategoryFindUnique).toHaveBeenCalledWith({
      where: { name: "课程标准" },
      select: { id: true },
    });
    expect(state).toEqual({
      ok: false,
      message: "分类“课程标准”已存在",
      fieldErrors: { name: ["分类名称重复"] },
    });
    expect(mocks.docCategoryCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("用当前最大 sortOrder 的下一个十位值创建并刷新 /profile", async () => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);

    const state = await createDocCategory(IDLE_FORM_STATE, categoryForm("教学参考"));

    expect(mocks.docCategoryAggregate).toHaveBeenCalledWith({ _max: { sortOrder: true } });
    expect(mocks.docCategoryCreate).toHaveBeenCalledWith({
      data: { name: "教学参考", sortOrder: 50 },
      select: { id: true },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(state).toEqual({ ok: true, message: "已添加分类“教学参考”" });
  });

  it.each([
    ["字段数组", { modelName: "DocCategory", target: ["name"] }],
    ["索引名", { modelName: "DocCategory", target: "DocCategory_name_key" }],
    ["字段对象", { modelName: "DocCategory", target: { fields: ["name"] } }],
    [
      "driver adapter constraint",
      {
        modelName: "DocCategory",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["name"] },
          },
        },
      },
    ],
  ])("并发创建的 P2002 %s 明确指向 DocCategory.name 时返回友好 FormState", async (_label, meta) => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);
    mocks.docCategoryCreate.mockRejectedValue(prismaKnownError("P2002", meta));

    const state = await createDocCategory(IDLE_FORM_STATE, categoryForm("教学参考"));

    expect(state).toEqual({
      ok: false,
      message: "分类“教学参考”已存在",
      fieldErrors: { name: ["分类名称重复"] },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["id target", prismaKnownError("P2002", { modelName: "DocCategory", target: ["id"] })],
    ["unknown target", prismaKnownError("P2002", { modelName: "DocCategory" })],
    [
      "shape-like object",
      Object.assign(new Error("not from Prisma"), {
        code: "P2002",
        meta: { modelName: "DocCategory", target: ["name"] },
      }),
    ],
  ])("P2002 %s 不能误报为分类重名", async (_label, conflict) => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);
    mocks.docCategoryCreate.mockRejectedValue(conflict);

    await expect(
      createDocCategory(IDLE_FORM_STATE, categoryForm("教学参考")),
    ).rejects.toBe(conflict);

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("Serializable 分配 sortOrder 遇 P2034 后有界重试并可成功", async () => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);
    const conflict = prismaKnownError("P2034", { modelName: "DocCategory" });
    mocks.transaction.mockImplementationOnce(async (callback) => {
      await callback(transactionClient());
      throw conflict;
    });

    const state = await createDocCategory(IDLE_FORM_STATE, categoryForm("教学参考"));

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.docCategoryAggregate).toHaveBeenCalledTimes(2);
    expect(mocks.docCategoryCreate).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(state).toEqual({ ok: true, message: "已添加分类“教学参考”" });
  });

  it("P2034 连续冲突时最多尝试 3 次并保留最后一个 Prisma 错误", async () => {
    mocks.docCategoryFindUnique.mockResolvedValue(null);
    const conflict = prismaKnownError("P2034", { modelName: "DocCategory" });
    mocks.transaction.mockImplementation(async (callback) => {
      await callback(transactionClient());
      throw conflict;
    });

    await expect(
      createDocCategory(IDLE_FORM_STATE, categoryForm("教学参考")),
    ).rejects.toBe(conflict);

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.docCategoryAggregate).toHaveBeenCalledTimes(3);
    expect(mocks.docCategoryCreate).toHaveBeenCalledTimes(3);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("空名称不访问数据库", async () => {
    const state = await createDocCategory(IDLE_FORM_STATE, categoryForm("   "));

    expect(state).toMatchObject({ ok: false, fieldErrors: { name: ["请填写分类名称"] } });
    expect(mocks.docCategoryFindUnique).not.toHaveBeenCalled();
    expect(mocks.docCategoryAggregate).not.toHaveBeenCalled();
    expect(mocks.docCategoryCreate).not.toHaveBeenCalled();
  });
});

describe("删除个人常用文档", () => {
  it("现有 deleteAttachment 把个人文档推断为 PersonalDocument，不误记 Achievement", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(storedAttachment());

    await deleteAttachment("attachment-1", "/attacker-controlled");

    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "PersonalDocument",
        entityId: "attachment-1",
        action: "删除个人常用文档",
        detail: { filename: "课程标准.pdf", categoryId: "category-1" },
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/attacker-controlled");
  });

  it("个人入口成功删除时固定刷新 /profile，不接受客户端 path", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(storedAttachment());

    const state = await deletePersonalAttachment("attachment-1");

    expect(mocks.attachmentDelete).toHaveBeenCalledWith({ where: { id: "attachment-1" } });
    expect(mocks.attachmentDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUpload.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteUpload).toHaveBeenCalledWith("personal-documents/file.pdf");
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(state).toEqual({ ok: true, message: "已删除 课程标准.pdf" });
  });

  it("文档不存在时返回可用 FormState，不删库也不删盘", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(null);

    const state = await deletePersonalAttachment("missing");

    expect(state).toEqual({ ok: false, message: "个人常用文档不存在" });
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
    expect(mocks.deleteUpload).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("个人入口不能借附件编号删除课题或成果附件", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(
      storedAttachment({
        projectId: "project-1",
        achievementId: null,
        docCategoryId: null,
        storagePath: "projects/project-1/file.pdf",
      }),
    );

    const state = await deletePersonalAttachment("attachment-1");

    expect(state).toEqual({ ok: false, message: "这不是个人常用文档" });
    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
    expect(mocks.deleteUpload).not.toHaveBeenCalled();
  });

  it("文件删除失败时记录可清理证据、刷新页面并返回准确状态", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(storedAttachment());
    const diskError = Object.assign(new Error("disk unavailable"), { code: "EIO" });
    mocks.deleteUpload.mockRejectedValue(diskError);

    const state = await deletePersonalAttachment("attachment-1");

    expect(mocks.attachmentDelete).toHaveBeenCalledOnce();
    expect(mocks.attachmentDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUpload.mock.invocationCallOrder[0],
    );
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "PersonalDocument",
        entityId: "attachment-1",
        action: "个人常用文档文件清理待处理",
        detail: {
          attachmentId: "attachment-1",
          storagePath: "personal-documents/file.pdf",
          docCategoryId: "category-1",
          errorCode: "EIO",
        },
      },
    });
    expect(cleanupEventSpy).toHaveBeenCalledWith({
      event: "attachment_cleanup_failed",
      operation: "personal-delete-cleanup",
      storagePath: "personal-documents/file.pdf",
      errorCode: "EIO",
      attachmentId: "attachment-1",
      docCategoryId: "category-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(state).toEqual({
      ok: true,
      tone: "warning",
      message: "记录已删除，文件清理待处理",
    });
  });

  it("文件清理和待处理 Activity 同时失败时只聚合安全摘要且仍刷新", async () => {
    const privatePath = "C:\\private\\cleanup\\课程标准.pdf";
    mocks.attachmentFindUnique.mockResolvedValue(storedAttachment({ storagePath: privatePath }));
    const diskError = Object.assign(new Error(`disk unavailable at ${privatePath}`), {
      code: "EACCES",
    });
    diskError.stack = `PRIVATE_DISK_STACK at ${privatePath}`;
    const activityError = Object.assign(
      new Error(`activity unavailable for 课程标准.pdf and private note at ${privatePath}`),
      { code: "P2003" },
    );
    activityError.stack = `PRIVATE_ACTIVITY_STACK at ${privatePath}`;
    Object.defineProperty(activityError, "hiddenPrivateDetail", {
      value: "hidden activity note",
      enumerable: false,
    });
    Object.defineProperty(activityError, Symbol("private-activity-symbol"), {
      value: "symbol activity note",
      enumerable: true,
    });
    mocks.deleteUpload.mockRejectedValue(diskError);
    mocks.activityCreate.mockRejectedValue(activityError);

    let caught: unknown;
    try {
      await deletePersonalAttachment("attachment-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError & { cause?: unknown };
    expect(aggregate.errors).toEqual([
      {
        name: "AttachmentOperationFailure",
        operation: "personal-delete-cleanup",
        kind: "cleanup",
        code: "EACCES",
      },
      {
        name: "AttachmentOperationFailure",
        operation: "personal-delete-audit",
        kind: "audit",
        code: "P2003",
      },
    ]);
    expect(aggregate.cause).toBeUndefined();
    const inspectedAggregate = inspect(aggregate, { showHidden: true, depth: null });
    expect(inspectedAggregate).not.toContain("课程标准.pdf");
    expect(inspectedAggregate).not.toContain("private note");
    expect(inspectedAggregate).not.toContain(privatePath);
    expect(inspectedAggregate).not.toContain("disk unavailable");
    expect(inspectedAggregate).not.toContain("activity unavailable");
    expect(inspectedAggregate).not.toContain("PRIVATE_DISK_STACK");
    expect(inspectedAggregate).not.toContain("PRIVATE_ACTIVITY_STACK");
    expect(inspectedAggregate).not.toContain("hidden activity note");
    expect(inspectedAggregate).not.toContain("symbol activity note");
    expect(mocks.attachmentDelete).toHaveBeenCalledOnce();
    expect(mocks.activityCreate).toHaveBeenCalledOnce();
    expect(cleanupEventSpy).toHaveBeenCalledWith({
      event: "attachment_cleanup_failed",
      operation: "personal-delete-cleanup",
      errorCode: "EACCES",
      attachmentId: "attachment-1",
      docCategoryId: "category-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("文件路径异常时待清理证据不记录绝对路径", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(
      storedAttachment({ storagePath: "C:\\private\\secret.pdf" }),
    );
    mocks.deleteUpload.mockRejectedValue(
      Object.assign(new Error("unsafe path rejected"), { code: "EACCES" }),
    );

    const state = await deletePersonalAttachment("attachment-1");

    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        entityType: "PersonalDocument",
        entityId: "attachment-1",
        action: "个人常用文档文件清理待处理",
        detail: {
          attachmentId: "attachment-1",
          docCategoryId: "category-1",
          errorCode: "EACCES",
        },
      },
    });
    expect(cleanupEventSpy).toHaveBeenCalledWith({
      event: "attachment_cleanup_failed",
      operation: "personal-delete-cleanup",
      errorCode: "EACCES",
      attachmentId: "attachment-1",
      docCategoryId: "category-1",
    });
    expect(JSON.stringify(cleanupEventSpy.mock.calls[0])).not.toContain("C:\\\\private");
    expect(state).toEqual({
      ok: true,
      tone: "warning",
      message: "记录已删除，文件清理待处理",
    });
  });

  it("异常的多重归属在删库前硬失败", async () => {
    mocks.attachmentFindUnique.mockResolvedValue(
      storedAttachment({ projectId: "project-1", docCategoryId: "category-1" }),
    );

    await expect(deletePersonalAttachment("attachment-1")).rejects.toThrow(/归属异常/);

    expect(mocks.attachmentDelete).not.toHaveBeenCalled();
    expect(mocks.deleteUpload).not.toHaveBeenCalled();
  });
});
