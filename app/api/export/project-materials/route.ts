import { prisma } from "@/lib/db";
import { loadProjectMaterialSources } from "@/lib/export/material-sources";
import { buildMaterialZipPlan } from "@/lib/export/materials-zip";
import { isSameOrigin } from "@/lib/export/request";
import { openUploadStream } from "@/lib/storage";
import { sessionGuard } from "@/lib/server-auth";
import { zipStream, type ZipSource } from "@/lib/zip";

/**
 * 课题材料 ZIP（规格 7.4）。
 *
 * `POST /api/export/project-materials` → application/zip
 *
 * 走 Route Handler 而不是 Server Action：要返回一个字节流，
 * 而 Server Action 的返回值是序列化过的 JS 值，塞不了二进制。
 *
 * **流式生成**：附件逐个、逐块读出来直接写进响应，任何时刻内存里
 * 只有 64KB 级别的块，跟附件总大小无关。
 */

/** 整包上限。真超了多半是误操作，先拦下来问一句比让浏览器下半小时强 */
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  // 公开端点，自己验会话——「入口只在登录后的页面上」不构成安全边界
  const denied = await sessionGuard();
  if (denied) return denied;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl, request.headers.get("origin"))) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const projectId = form.get("projectId");
  if (typeof projectId !== "string" || projectId === "") {
    return Response.json({ error: "缺少课题标识" }, { status: 400 });
  }

  // 没有 attachmentIds 字段 = 整包下载；有则是勾选下载。
  // **空数组不等于全选**——勾了又全取消还点下载，该得到一句提示而不是整包
  const rawSelected = form.getAll("attachmentIds");
  const selectedIds = form.has("attachmentIds")
    ? rawSelected.filter((value): value is string => typeof value === "string")
    : null;

  const sources = await loadProjectMaterialSources(projectId);
  if (!sources) {
    return Response.json({ error: "课题不存在" }, { status: 404 });
  }

  const plan = buildMaterialZipPlan({
    projectMaterials: sources.projectMaterials,
    achievementEvidence: sources.achievementEvidence,
    selectedIds,
  });

  if (plan.entries.length === 0) {
    return Response.json({ error: "没有可打包的材料" }, { status: 400 });
  }
  if (plan.unknownSelectedIds.length > 0) {
    // 勾了不属于本课题的材料：拒绝整次请求，不悄悄少打几份。
    // 悄悄少打的话，用户拿着不全的包去交材料才发现
    return Response.json(
      { error: "勾选的材料里有不属于本课题的，请刷新页面后重试" },
      { status: 400 },
    );
  }
  if (plan.totalBytes > MAX_TOTAL_BYTES) {
    return Response.json(
      {
        error: `本次要打包 ${Math.round(plan.totalBytes / 1024 / 1024)}MB，超过 ${
          MAX_TOTAL_BYTES / 1024 / 1024
        }MB 上限，请分批勾选下载`,
      },
      { status: 413 },
    );
  }

  const zipSources: ZipSource[] = plan.entries.map((entry) => ({
    name: entry.name,
    mtime: entry.uploadedAt,
    read: openUploadStream(entry.storagePath),
  }));

  // 先记审计再出流。**反过来不行**：流一旦开始写就没有事务可言，
  // 中途失败时记录已经发出去了，反而记下一次并没有完成的导出。
  // 这里的取舍是「记了但下载失败」好过「下载了但没记」——
  // 前者看日志能对上，后者材料已经出门却查不到。
  await prisma.exportRun.create({
    data: {
      kind: "MATERIAL_ZIP",
      projectId,
      options: { selected: selectedIds != null, selectedCount: selectedIds?.length ?? null },
      includedCount: plan.entries.length,
      issueSummary: [],
      snapshot: plan.entries.map((entry) => ({
        attachmentId: entry.attachmentId,
        name: entry.name,
        size: entry.size,
        source: entry.source,
      })),
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of zipStream(zipSources)) {
          controller.enqueue(new Uint8Array(chunk));
        }
        controller.close();
      } catch (error) {
        // 中途出错就让连接以错误收场。浏览器会把它当成下载失败，
        // 而不是留下一个看着完整、实际截断的 zip
        controller.error(error);
      }
    },
  });

  const filename = `${sources.projectCode ? `${sources.projectCode}_` : ""}${
    sources.projectTitle
  }_材料.zip`;

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      // 不设 Content-Length：流式生成时总长度要打完包才知道，
      // 设错比不设更糟——浏览器会按错误的长度截断
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
