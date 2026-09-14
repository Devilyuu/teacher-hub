"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { toFormState, type FormState } from "@/lib/form-state";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession } from "@/lib/server-auth";
import { attachmentUploadSchema } from "@/lib/schemas/attachment";
import { requirementReportUploadFormSchema } from "@/lib/schemas/material";
import {
  docCategoryCreateSchema,
  personalDocumentUploadSchema,
} from "@/lib/schemas/personal-document";
import {
  achievementScope,
  deleteUpload,
  isAllowedUpload,
  MAX_UPLOAD_BYTES,
  competitionEntryScope,
  personalScope,
  projectScope,
  saveUpload,
  studentHonorScope,
} from "@/lib/storage";
import type { AttachmentKind } from "@/lib/generated/prisma/enums";

/** 五种归属是闭合的可辨识联合，调用方不能组合出多重 owner。
 *  （库里是六选一，第六个 teachingImportId 只由回流接口写，不走这里） */
type Owner =
  | { kind: "project"; id: string }
  | { kind: "achievement"; id: string }
  | { kind: "personal"; docCategoryId: string }
  | { kind: "studentHonor"; id: string }
  | { kind: "competitionEntry"; id: string };

type OwnerFields = {
  projectId: string | null;
  achievementId: string | null;
  docCategoryId: string | null;
  studentHonorId: string | null;
  competitionEntryId: string | null;
};

type UploadOptions = {
  forcedKind?: AttachmentKind;
  requirementId?: string;
  legacyAchievementId?: string;
};

function ownerPath(owner: Owner): string {
  switch (owner.kind) {
    case "project":
      return `/projects/${owner.id}`;
    case "achievement":
      return `/achievements/${owner.id}`;
    case "personal":
      return "/profile";
    case "studentHonor":
      return `/students/honors/${owner.id}`;
    case "competitionEntry":
      return `/competitions/${owner.id}`;
  }
}

/**
 * 磁盘目录。**写成穷尽的 switch 而不是三元链**：原来的链子以
 * `: personalScope()` 兜底，新加一种归属而忘了加分支，文件会一声不响地
 * 落进个人文档目录——没有报错，只有放错地方的文件。switch 缺分支类型报错。
 */
function scopeFor(owner: Owner): string {
  switch (owner.kind) {
    case "project":
      return projectScope(owner.id);
    case "achievement":
      return achievementScope(owner.id);
    case "studentHonor":
      return studentHonorScope(owner.id);
    case "competitionEntry":
      return competitionEntryScope(owner.id);
    case "personal":
      return personalScope();
  }
}

/** 唯一负责生成 owner 列，每个分支始终恰好一列非空。 */
function ownerFields(owner: Owner): OwnerFields {
  const empty: OwnerFields = {
    projectId: null,
    achievementId: null,
    docCategoryId: null,
    studentHonorId: null,
    competitionEntryId: null,
  };
  switch (owner.kind) {
    case "project":
      return { ...empty, projectId: owner.id };
    case "achievement":
      return { ...empty, achievementId: owner.id };
    case "personal":
      return { ...empty, docCategoryId: owner.docCategoryId };
    case "studentHonor":
      return { ...empty, studentHonorId: owner.id };
    case "competitionEntry":
      return { ...empty, competitionEntryId: owner.id };
  }
}

type CleanupOperation = "upload-compensation" | "personal-delete-cleanup";
type SafeFailureOperation = CleanupOperation | "upload-transaction" | "personal-delete-audit";
type SafeFailureKind = "primary" | "cleanup" | "audit";

type SafeFailureSummary = Readonly<{
  name: "AttachmentOperationFailure";
  operation: SafeFailureOperation;
  kind: SafeFailureKind;
  code: string;
}>;

const FILE_CLEANUP_ERROR_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EIO",
  "ENOENT",
  "EPERM",
  "EROFS",
]);

const DATA_ERROR_CODES = new Set(["P2002", "P2003", "P2025", "P2034"]);

function allowedErrorCode(error: unknown, allowedCodes: ReadonlySet<string>): string {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) return "UNKNOWN";
    const code = error.code;
    return typeof code === "string" && allowedCodes.has(code) ? code : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

function cleanupErrorCode(error: unknown): string {
  return allowedErrorCode(error, FILE_CLEANUP_ERROR_CODES);
}

function safeFailureSummary(input: {
  operation: SafeFailureOperation;
  kind: SafeFailureKind;
  error: unknown;
}): SafeFailureSummary {
  const allowedCodes = input.kind === "cleanup" ? FILE_CLEANUP_ERROR_CODES : DATA_ERROR_CODES;
  return Object.freeze({
    name: "AttachmentOperationFailure",
    operation: input.operation,
    kind: input.kind,
    code: allowedErrorCode(input.error, allowedCodes),
  });
}

function safeRelativeStoragePath(storagePath: string): string | undefined {
  if (
    !/^[a-zA-Z0-9_./-]+$/.test(storagePath) ||
    storagePath.startsWith("/") ||
    storagePath.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }
  return storagePath;
}

function reportCleanupFailure(input: {
  operation: CleanupOperation;
  storagePath: string;
  error: unknown;
  attachmentId?: string;
  docCategoryId?: string;
}): void {
  const storagePath = safeRelativeStoragePath(input.storagePath);
  try {
    console.error({
      event: "attachment_cleanup_failed",
      operation: input.operation,
      ...(storagePath ? { storagePath } : {}),
      errorCode: cleanupErrorCode(input.error),
      ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
      ...(input.docCategoryId ? { docCategoryId: input.docCategoryId } : {}),
    });
  } catch {
    // 日志本身是 fail-safe，不能反过来遮蔽原始业务错误和文件清理错误。
  }
}

/** 表单校验 + 落盘 + 建记录。三种附件入口共用，差别只在归属。 */
async function uploadAttachment(
  owner: Owner,
  formData: FormData,
  options: UploadOptions = {},
): Promise<FormState> {
  const parsed = attachmentUploadSchema.safeParse({
    kind: options.forcedKind ?? formData.get("kind"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return toFormState(parsed.error);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "请选择要上传的文件", fieldErrors: { file: ["未选择文件"] } };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `文件 ${Math.round(file.size / 1024 / 1024)}MB，超过 ${Math.round(
        MAX_UPLOAD_BYTES / 1024 / 1024,
      )}MB 上限`,
      fieldErrors: { file: ["文件过大"] },
    };
  }

  if (!isAllowedUpload(file.type, file.name)) {
    return {
      ok: false,
      message: `不支持的文件类型（${file.type || "未知"}）。可传 PDF、Word、Excel、PPT、图片、zip`,
      fieldErrors: { file: ["类型不支持"] },
    };
  }

  // 确认归属对象存在再落盘，免得留下没有归属的孤儿文件。
  // 分类 id 虽然来自下拉框，仍是不可信的 FormData，必须到库里重读。
  let personalCategory: { id: string; name: string } | null = null;
  if (owner.kind === "project") {
    const project = await prisma.project.findUnique({
      where: { id: owner.id },
      select: { id: true },
    });
    if (!project) return { ok: false, message: "课题不存在" };
  } else if (owner.kind === "achievement") {
    const achievement = await prisma.achievement.findUnique({
      where: { id: owner.id },
      select: { id: true },
    });
    if (!achievement) return { ok: false, message: "成果不存在" };
  } else if (owner.kind === "studentHonor") {
    const honor = await prisma.studentHonor.findUnique({
      where: { id: owner.id },
      select: { id: true },
    });
    if (!honor) return { ok: false, message: "这条荣誉已经不在了" };
  } else if (owner.kind === "competitionEntry") {
    const entry = await prisma.competitionEntry.findUnique({
      where: { id: owner.id },
      select: { id: true },
    });
    if (!entry) return { ok: false, message: "这条参赛记录已经不在了" };
  } else {
    personalCategory = await prisma.docCategory.findUnique({
      where: { id: owner.docCategoryId },
      select: { id: true, name: true },
    });
    if (!personalCategory) {
      return {
        ok: false,
        message: "文档分类不存在，请重新选择",
        fieldErrors: { categoryId: ["分类不存在"] },
      };
    }
  }

  if (options.requirementId) {
    if (owner.kind !== "project") {
      return { ok: false, message: "结题要求只能关联课题材料" };
    }
    const requirement = await prisma.requirement.findUnique({
      where: { id: options.requirementId },
      select: { projectId: true },
    });
    if (!requirement || requirement.projectId !== owner.id) {
      return { ok: false, message: "找不到这条结题要求项" };
    }
  }

  let legacyQualification: {
    isQualified: boolean;
    qualifiedAt: Date | null;
    qualifyNote: string | null;
  } | null = null;
  if (options.legacyAchievementId) {
    if (!options.requirementId || owner.kind !== "project") {
      return { ok: false, message: "旧研究报告只能迁到课题结题要求" };
    }

    const legacy = await prisma.achievement.findUnique({
      where: { id: options.legacyAchievementId },
      select: {
        type: true,
        perfCategoryId: true,
        promotionCategoryId: true,
        usableFor: true,
        attachments: { select: { id: true } },
        links: {
          select: {
            requirementId: true,
            isQualified: true,
            qualifiedAt: true,
            qualifyNote: true,
          },
        },
      },
    });
    const eligible =
      legacy?.type === "REPORT" &&
      legacy.perfCategoryId == null &&
      legacy.promotionCategoryId == null &&
      legacy.usableFor.length === 1 &&
      legacy.usableFor[0] === "PROJECT_CLOSING" &&
      legacy.attachments.length === 0 &&
      legacy.links.length === 1 &&
      legacy.links[0].requirementId === options.requirementId;
    if (!eligible) {
      return {
        ok: false,
        message: "这条研究报告不符合自动迁移条件，请保留为独立成果",
      };
    }
    legacyQualification = {
      isQualified: legacy.links[0].isQualified,
      qualifiedAt: legacy.links[0].qualifiedAt,
      qualifyNote: legacy.links[0].qualifyNote,
    };
  }

  const saved = await saveUpload(file, scopeFor(owner));

  let attachment: { id: string };
  try {
    attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          ...ownerFields(owner),
          kind: parsed.data.kind,
          filename: file.name,
          storagePath: saved.storagePath,
          size: saved.size,
          mimeType: file.type,
          note: parsed.data.note,
        },
        select: { id: true },
      });

      if (owner.kind === "personal") {
        await logActivity(
          "PersonalDocument",
          created.id,
          "上传个人常用文档",
          {
            filename: file.name,
            categoryId: personalCategory!.id,
            categoryName: personalCategory!.name,
            kind: parsed.data.kind,
            size: saved.size,
          },
          tx,
        );
      }

      if (options.requirementId) {
        await tx.requirementAttachment.create({
          data: {
            requirementId: options.requirementId,
            attachmentId: created.id,
            ...(legacyQualification ?? {}),
          },
        });
      }
      if (options.legacyAchievementId) {
        await tx.achievement.delete({ where: { id: options.legacyAchievementId } });
      }
      return created;
    });
  } catch (error) {
    try {
      await deleteUpload(saved.storagePath);
    } catch (cleanupError) {
      reportCleanupFailure({
        operation: "upload-compensation",
        storagePath: saved.storagePath,
        error: cleanupError,
      });
      throw new AggregateError(
        [
          safeFailureSummary({
            operation: "upload-transaction",
            kind: "primary",
            error,
          }),
          safeFailureSummary({
            operation: "upload-compensation",
            kind: "cleanup",
            error: cleanupError,
          }),
        ],
        "附件保存失败，且刚落盘文件未能清理",
      );
    }
    throw error;
  }

  if (owner.kind !== "personal") {
    const entityType = uploadEntityType(owner);
    await logActivity(entityType, owner.id, "上传附件", {
      filename: file.name,
      kind: parsed.data.kind,
      size: saved.size,
    });
  }
  if (options.requirementId && owner.kind === "project") {
    await logActivity(
      "RequirementAttachment",
      `${options.requirementId}:${attachment.id}`,
      "上传并关联结题报告",
      { projectId: owner.id, filename: file.name },
    );
  }
  if (options.legacyAchievementId && owner.kind === "project") {
    await logActivity("Achievement", options.legacyAchievementId, "迁移为课题结题材料", {
      projectId: owner.id,
      requirementId: options.requirementId,
      attachmentId: attachment.id,
    });
  }

  revalidatePath(ownerPath(owner));
  return {
    ok: true,
    message: options.legacyAchievementId
      ? `已迁为课题结题材料 ${file.name}`
      : options.requirementId
        ? `已上传并关联结题报告 ${file.name}`
        : `已上传 ${file.name}`,
  };
}

export async function uploadProjectAttachment(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  return uploadAttachment({ kind: "project", id: projectId }, formData);
}

export async function uploadAchievementAttachment(
  achievementId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  return uploadAttachment({ kind: "achievement", id: achievementId }, formData);
}

export async function uploadPersonalAttachment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = personalDocumentUploadSchema.safeParse({
    categoryId: formData.get("categoryId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return toFormState(parsed.error);

  return uploadAttachment(
    { kind: "personal", docCategoryId: parsed.data.categoryId },
    formData,
    { forcedKind: "OTHER" },
  );
}

/** 奖状照片/扫描件（班主任模块）。类型钉死为获奖证书，不给下拉 */
export async function uploadStudentHonorAttachment(
  honorId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  return uploadAttachment({ kind: "studentHonor", id: honorId }, formData, {
    forcedKind: "AWARD_CERTIFICATE",
  });
}

/** 参赛材料：赛事通知、报名表、获奖证书。类型给下拉，不像奖状那样钉死 */
export async function uploadCompetitionAttachment(
  entryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  return uploadAttachment({ kind: "competitionEntry", id: entryId }, formData);
}

function duplicateCategoryState(name: string): FormState {
  return {
    ok: false,
    message: `分类“${name}”已存在`,
    fieldErrors: { name: ["分类名称重复"] },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExactNameFields(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === "name";
}

function isDocCategoryNameTarget(value: unknown): boolean {
  if (isExactNameFields(value)) return true;
  if (value === "name" || value === "DocCategory_name_key") return true;
  if (!isRecord(value)) return false;
  return (
    isExactNameFields(value.fields) ||
    value.index === "DocCategory_name_key"
  );
}

function isDocCategoryNameConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta;
  if (!isRecord(meta) || meta.modelName !== "DocCategory") return false;
  if (isDocCategoryNameTarget(meta.target)) return true;

  const adapterError = meta.driverAdapterError;
  if (!isRecord(adapterError)) return false;
  const cause = adapterError.cause;
  if (!isRecord(cause) || cause.kind !== "UniqueConstraintViolation") return false;
  return isDocCategoryNameTarget(cause.constraint);
}

function isTransactionWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

const DOC_CATEGORY_TRANSACTION_ATTEMPTS = 3;

export async function createDocCategory(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = docCategoryCreateSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return toFormState(parsed.error);

  const { name } = parsed.data;
  const duplicate = await prisma.docCategory.findUnique({
    where: { name },
    select: { id: true },
  });
  if (duplicate) return duplicateCategoryState(name);

  for (let attempt = 1; attempt <= DOC_CATEGORY_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const maximum = await tx.docCategory.aggregate({ _max: { sortOrder: true } });
          const sortOrder = (maximum._max.sortOrder ?? 0) + 10;
          await tx.docCategory.create({
            data: { name, sortOrder },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      // findUnique 和 create 之间可能有另一个请求抢先创建同名分类。
      if (isDocCategoryNameConflict(error)) return duplicateCategoryState(name);
      if (isTransactionWriteConflict(error) && attempt < DOC_CATEGORY_TRANSACTION_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }

  revalidatePath("/profile");
  return { ok: true, message: `已添加分类“${name}”` };
}

export async function uploadRequirementReport(
  projectId: string,
  requirementId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const legacyAchievementId = formData.get("legacyAchievementId");
  const parsed = requirementReportUploadFormSchema.safeParse({
    note: formData.get("note") ?? "",
    legacyAchievementId:
      typeof legacyAchievementId === "string" && legacyAchievementId !== ""
        ? legacyAchievementId
        : undefined,
  });
  if (!parsed.success) return toFormState(parsed.error);

  return uploadAttachment(
    { kind: "project", id: projectId },
    formData,
    {
      forcedKind: "FINAL_REPORT",
      requirementId,
      legacyAchievementId: parsed.data.legacyAchievementId,
    },
  );
}

/** 审计日志里这条附件算哪个实体。穷尽 switch，理由同 scopeFor */
function uploadEntityType(
  owner: Exclude<Owner, { kind: "personal" }>,
): "Project" | "Achievement" | "StudentHonor" | "CompetitionEntry" {
  switch (owner.kind) {
    case "project":
      return "Project";
    case "achievement":
      return "Achievement";
    case "studentHonor":
      return "StudentHonor";
    case "competitionEntry":
      return "CompetitionEntry";
  }
}

type StoredAttachmentOwner = {
  id: string;
  projectId: string | null;
  achievementId: string | null;
  docCategoryId: string | null;
  studentHonorId: string | null;
  competitionEntryId: string | null;
  storagePath: string;
  filename: string;
};

type InferredAttachmentOwner =
  | { kind: "project"; entityType: "Project"; entityId: string }
  | { kind: "achievement"; entityType: "Achievement"; entityId: string }
  | {
      kind: "personal";
      entityType: "PersonalDocument";
      entityId: string;
      categoryId: string;
    }
  | { kind: "studentHonor"; entityType: "StudentHonor"; entityId: string }
  | {
      kind: "competitionEntry";
      entityType: "CompetitionEntry";
      entityId: string;
    };

function inferStoredAttachmentOwner(attachment: StoredAttachmentOwner): InferredAttachmentOwner {
  const ownerCount = [
    attachment.projectId,
    attachment.achievementId,
    attachment.docCategoryId,
    attachment.studentHonorId,
    attachment.competitionEntryId,
  ].filter((value) => value !== null).length;
  if (ownerCount !== 1) {
    throw new Error(`附件 ${attachment.id} 归属异常，拒绝删除`);
  }

  if (attachment.projectId !== null) {
    return { kind: "project", entityType: "Project", entityId: attachment.projectId };
  }
  if (attachment.achievementId !== null) {
    return {
      kind: "achievement",
      entityType: "Achievement",
      entityId: attachment.achievementId,
    };
  }
  if (attachment.studentHonorId !== null) {
    return {
      kind: "studentHonor",
      entityType: "StudentHonor",
      entityId: attachment.studentHonorId,
    };
  }
  if (attachment.competitionEntryId !== null) {
    return {
      kind: "competitionEntry",
      entityType: "CompetitionEntry",
      entityId: attachment.competitionEntryId,
    };
  }
  return {
    kind: "personal",
    entityType: "PersonalDocument",
    entityId: attachment.id,
    categoryId: attachment.docCategoryId!,
  };
}

type DeleteAttachmentResult =
  | { status: "missing" }
  | { status: "wrong-owner" }
  | { status: "cleanup-pending" }
  | { status: "deleted"; filename: string };

async function deleteAttachmentInternal(
  attachmentId: string,
  ownerPathForRevalidate: string,
  expectedOwner?: InferredAttachmentOwner["kind"],
): Promise<DeleteAttachmentResult> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      projectId: true,
      achievementId: true,
      docCategoryId: true,
      studentHonorId: true,
      competitionEntryId: true,
      storagePath: true,
      filename: true,
    },
  });
  if (!attachment) return { status: "missing" };

  const owner = inferStoredAttachmentOwner(attachment);
  if (expectedOwner && owner.kind !== expectedOwner) return { status: "wrong-owner" };

  // 先删库再删盘：反过来的话删盘成功、删库失败会留下指向空文件的记录，
  // 而现在这个顺序最坏情况只是留个没人引用的孤儿文件，不影响使用。
  await prisma.attachment.delete({ where: { id: attachmentId } });
  try {
    await deleteUpload(attachment.storagePath);
  } catch (cleanupError) {
    if (owner.kind !== "personal") throw cleanupError;

    const relativeStoragePath = safeRelativeStoragePath(attachment.storagePath);
    const detail = {
      attachmentId: attachment.id,
      ...(relativeStoragePath ? { storagePath: relativeStoragePath } : {}),
      docCategoryId: owner.categoryId,
      errorCode: cleanupErrorCode(cleanupError),
    };
    let activityError: unknown;
    try {
      await logActivity(
        "PersonalDocument",
        owner.entityId,
        "个人常用文档文件清理待处理",
        detail,
      );
    } catch (error) {
      activityError = error;
    }
    reportCleanupFailure({
      operation: "personal-delete-cleanup",
      storagePath: attachment.storagePath,
      error: cleanupError,
      attachmentId: attachment.id,
      docCategoryId: owner.categoryId,
    });
    revalidatePath("/profile");

    if (activityError !== undefined) {
      throw new AggregateError(
        [
          safeFailureSummary({
            operation: "personal-delete-cleanup",
            kind: "cleanup",
            error: cleanupError,
          }),
          safeFailureSummary({
            operation: "personal-delete-audit",
            kind: "audit",
            error: activityError,
          }),
        ],
        "个人常用文档记录已删除，但文件清理与待处理审计均失败",
      );
    }
    return { status: "cleanup-pending" };
  }

  if (owner.kind === "personal") {
    await logActivity(owner.entityType, owner.entityId, "删除个人常用文档", {
      filename: attachment.filename,
      categoryId: owner.categoryId,
    });
  } else {
    await logActivity(owner.entityType, owner.entityId, "删除附件", {
      filename: attachment.filename,
    });
  }

  // 个人文档即便经兼容的通用入口删除，也不使用客户端传来的 path。
  revalidatePath(owner.kind === "personal" ? "/profile" : ownerPathForRevalidate);
  return { status: "deleted", filename: attachment.filename };
}

export async function deleteAttachment(attachmentId: string, ownerPathForRevalidate: string) {
  await requireSession();
  await deleteAttachmentInternal(attachmentId, ownerPathForRevalidate);
}

/** 个人文档入口不收 revalidate path，避免把任意路径当成客户端参数。 */
export async function deletePersonalAttachment(attachmentId: string): Promise<FormState> {
  await requireSession();
  const result = await deleteAttachmentInternal(attachmentId, "/profile", "personal");
  if (result.status === "missing") {
    return { ok: false, message: "个人常用文档不存在" };
  }
  if (result.status === "wrong-owner") {
    return { ok: false, message: "这不是个人常用文档" };
  }
  if (result.status === "cleanup-pending") {
    return { ok: true, tone: "warning", message: "记录已删除，文件清理待处理" };
  }
  return { ok: true, message: `已删除 ${result.filename}` };
}
