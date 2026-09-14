import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { auditPayload, teachingImportPayloadSchema } from "@/lib/schemas/teaching-import";
import {
  MAX_UPLOAD_BYTES,
  deleteUpload,
  isAllowedUpload,
  saveUpload,
  teachingImportScope,
} from "@/lib/storage";
import { teachingImportGuard } from "@/lib/teaching-auth";

/**
 * 教案回流（规格 §7.6、§6.6；设计见
 * `docs/superpowers/specs/2026-08-05-teaching-import-design.md`）。
 *
 * `POST /api/teaching/import` ← 备课系统调用
 *
 * **这个接口没有会话 cookie**，靠 `Authorization: Bearer` 鉴权，并且在
 * `isPublicUnauthenticatedPath` 白名单里——否则 proxy 会把外部调用重定向到
 * HTML 登录页，对方拿到一张网页而不是 401。白名单条目在
 * `scripts/verify-server-actions-auth.mjs` 的 PUBLIC_ROUTES 里登记，
 * 那个门禁是这条边界唯一的机器保障。
 *
 * **不自动创建成果**（第 1 条铁律 + 规格 §6.6）：教案按周产出，自动入库会把
 * 待核实队列淹掉。回流只落 `TeachingImport`，用户在教学页点「引用为成果」才写台账。
 *
 * **同一个 `externalId` 重推即覆盖**：备课系统那边一次课要反复导出，只有最后
 * 一份值得留档，所以幂等键定位的是「哪一次课」而不是「哪一次导出」。
 * 唯一的例外是已引用为成果（`ADOPTED`）的记录，见下面的 409。
 */

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: Request) {
  const denied = teachingImportGuard(request);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "请求体不是合法的 multipart/form-data" }, { status: 400 });
  }

  const parsed = teachingImportPayloadSchema.safeParse({
    externalSystem: text(form, "externalSystem"),
    externalId: text(form, "externalId"),
    title: text(form, "title"),
    courseName: text(form, "courseName"),
    term: text(form, "term"),
    finishedAt: text(form, "finishedAt"),
    note: text(form, "note"),
  });

  if (!parsed.success) {
    return Response.json(
      { error: "载荷不合法", issues: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const rawFile = form.get("file");
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

  if (file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限` },
        { status: 413 },
      );
    }
    if (!isAllowedUpload(file.type, file.name)) {
      return Response.json({ error: "不支持的文件类型" }, { status: 400 });
    }
  }

  // 幂等靠数据库唯一键，**不靠先查后写**——并发重试下后者会双双查空、双双插入
  let record: { id: string; status: string };
  let created = false;
  try {
    record = await prisma.teachingImport.create({
      data: {
        externalSystem: input.externalSystem,
        externalId: input.externalId,
        title: input.title,
        courseName: input.courseName ?? null,
        term: input.term ?? null,
        finishedAt: input.finishedAt ?? null,
        note: input.note ?? null,
        // 显式挑字段。整体转存请求会把 Authorization 一起写进库，
        // 而那毫无症状——直到全库备份（3.8）把令牌一起送出门
        payload: auditPayload(input) as Prisma.InputJsonObject,
      },
      select: { id: true, status: true },
    });
    created = true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await prisma.teachingImport.findUnique({
      where: {
        externalSystem_externalId: {
          externalSystem: input.externalSystem,
          externalId: input.externalId,
        },
      },
      select: { id: true, status: true },
    });
    if (!existing) throw error;

    // 已引用为成果的记录不接受覆盖。那一步把附件改挂到了成果上，材料可能
    // 已经进了申报包——重推要么无处可换，要么悄悄改掉台账里的东西。
    // 让对方看见 409，而不是以为覆盖成功了
    if (existing.status === "ADOPTED") {
      return Response.json(
        {
          id: existing.id,
          status: existing.status,
          created: false,
          replaced: false,
          error: "该教案已引用为成果，请先在工作台取消引用再重新推送",
        },
        { status: 409 },
      );
    }

    // 重推即覆盖：对方反复导出同一次课，送来的最后一份才是要留档的那份。
    // 顺带把忽略过或失败过的记录放回待处理——对方主动重推就是要它重新出现
    await prisma.teachingImport.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        courseName: input.courseName ?? null,
        term: input.term ?? null,
        finishedAt: input.finishedAt ?? null,
        note: input.note ?? null,
        payload: auditPayload(input) as Prisma.InputJsonObject,
        status: "RECEIVED",
        failureReason: null,
        handledAt: null,
      },
    });

    if (!file) {
      return Response.json(
        { id: existing.id, status: "RECEIVED", created: false, replaced: true },
        { status: 200 },
      );
    }

    const replacement = await replaceFile(existing.id, file);
    return Response.json(
      {
        id: existing.id,
        status: replacement.status,
        created: false,
        replaced: true,
        attachmentStored: replacement.ok,
      },
      { status: 200 },
    );
  }

  if (!file) {
    return Response.json({ id: record.id, status: record.status, created }, { status: 201 });
  }

  const attached = await attachFile(record.id, file);
  return Response.json(
    { id: record.id, status: attached.status, created, attachmentStored: attached.ok },
    { status: 201 },
  );
}

/**
 * 覆盖已有的教案文件。
 *
 * **先落新的、确认成功了再删旧的。** 反过来写的话，一次失败的重推会让记录
 * 既没有新文件也没有旧文件——对方以为只是没推上去，实际上把留档弄丢了。
 */
async function replaceFile(
  teachingImportId: string,
  file: File,
): Promise<{ ok: boolean; status: string }> {
  const stale = await prisma.attachment.findMany({
    where: { teachingImportId },
    select: { id: true, storagePath: true },
  });

  const attached = await attachFile(teachingImportId, file);
  if (!attached.ok) return attached;

  await prisma.attachment.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
  for (const item of stale) {
    try {
      await deleteUpload(item.storagePath);
    } catch {
      // 与 attachFile 一致：清理失败只留孤儿文件，不该盖掉这次成功的结果
    }
  }
  return attached;
}

/**
 * 落盘 → 写库 → 失败补偿删文件（沿用 `lib/actions/attachment-actions.ts` 的顺序）。
 *
 * 失败不抛给调用方 500，而是把记录标成 `FAILED` 并写 `failureReason`：
 * 教案本身已经收到了，丢掉整条记录反而让对方无从得知发生过什么。
 * 状态留在那里，对方带同一个 `externalId` 重试即可补上附件。
 */
async function attachFile(
  teachingImportId: string,
  file: File,
): Promise<{ ok: boolean; status: string }> {
  let saved: { storagePath: string; size: number } | null = null;
  try {
    saved = await saveUpload(file, teachingImportScope(teachingImportId));
    await prisma.attachment.create({
      data: {
        teachingImportId,
        kind: "TEACHING_PLAN",
        filename: file.name,
        storagePath: saved.storagePath,
        size: saved.size,
        mimeType: file.type || "application/octet-stream",
      },
    });
    // 之前失败过的记录这次补成了，退回正常状态
    await prisma.teachingImport.update({
      where: { id: teachingImportId },
      data: { status: "RECEIVED", failureReason: null },
    });
    return { ok: true, status: "RECEIVED" };
  } catch (error) {
    if (saved) {
      try {
        await deleteUpload(saved.storagePath);
      } catch {
        // 补偿失败只留孤儿文件，不影响状态判断——别让清理错误盖掉真正的原因
      }
    }
    await prisma.teachingImport.update({
      where: { id: teachingImportId },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message.slice(0, 500) : "附件写入失败",
      },
    });
    return { ok: false, status: "FAILED" };
  }
}
