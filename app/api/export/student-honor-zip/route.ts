import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/export/request";
import { openUploadStream } from "@/lib/storage";
import { sessionGuard } from "@/lib/server-auth";
import { zipStream, type ZipSource } from "@/lib/zip";

/**
 * 奖状包（zip）。评优申报的「凑一沓奖状」那半件事。
 *
 * 与课题材料 ZIP 同一套底盘（lib/zip.ts 流式打包），但**归属互不越界**：
 * 这里只取 studentHonorId 非空的附件，个人文档、课题材料混不进来
 * ——五选一 CHECK 保证一份附件只有一个归属。
 */

const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** 进 ZIP 的目录名不能带路径分隔符和 Windows 保留字符 */
function safeEntrySegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "_";
}

export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl, request.headers.get("origin"))) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const classGroupId = form.get("classGroupId");
  if (typeof classGroupId !== "string" || classGroupId === "") {
    return Response.json({ error: "缺少班级标识" }, { status: 400 });
  }

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true, name: true },
  });
  if (!classGroup) {
    return Response.json({ error: "班级不存在" }, { status: 404 });
  }

  const honors = await prisma.studentHonor.findMany({
    where: { classGroupId: classGroup.id },
    orderBy: [{ awardedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      title: true,
      attachments: {
        orderBy: { uploadedAt: "asc" },
        select: {
          id: true,
          filename: true,
          storagePath: true,
          size: true,
          uploadedAt: true,
        },
      },
    },
  });

  const usedNames = new Set<string>();
  const entries: Array<{ name: string; storagePath: string; size: number; mtime: Date }> = [];
  honors.forEach((honor, index) => {
    if (honor.attachments.length === 0) return;
    const folder = `${String(index + 1).padStart(2, "0")}_${safeEntrySegment(honor.title)}`;
    for (const attachment of honor.attachments) {
      let name = `${folder}/${safeEntrySegment(attachment.filename)}`;
      // 同一荣誉下同名文件（连拍两张 IMG_0001.jpg）靠 id 前缀分开，不静默覆盖
      if (usedNames.has(name)) {
        name = `${folder}/${attachment.id.slice(0, 6)}_${safeEntrySegment(attachment.filename)}`;
      }
      usedNames.add(name);
      entries.push({
        name,
        storagePath: attachment.storagePath,
        size: attachment.size,
        mtime: attachment.uploadedAt,
      });
    }
  });

  if (entries.length === 0) {
    return Response.json({ error: "还没有奖状可打包，先在荣誉详情里上传" }, { status: 400 });
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return Response.json(
      {
        error: `本次要打包 ${Math.round(totalBytes / 1024 / 1024)}MB，超过 ${
          MAX_TOTAL_BYTES / 1024 / 1024
        }MB 上限`,
      },
      { status: 413 },
    );
  }

  const zipSources: ZipSource[] = entries.map((entry) => ({
    name: entry.name,
    mtime: entry.mtime,
    read: openUploadStream(entry.storagePath),
  }));

  // 先记审计再出流（与课题材料 ZIP 同序）：「记了但下载失败」好过「下载了但没记」
  await logActivity("ClassGroup", classGroup.id, "导出奖状包", {
    entryCount: entries.length,
    totalBytes,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of zipStream(zipSources)) {
          controller.enqueue(new Uint8Array(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const filename = `${classGroup.name}_奖状.zip`;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
