import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isSameOriginRequest } from "@/lib/export/request";
import { openUploadStream } from "@/lib/storage";
import { sessionGuard } from "@/lib/server-auth";
import { zipStream, type ZipSource } from "@/lib/zip";

/**
 * 学生项目材料包（zip）。答辩前把任务书、开题报告、作品文件一次拿走。
 *
 * 与奖状包、课题材料 ZIP 同一套底盘（lib/zip.ts 流式 store-only 打包），
 * 但**归属互不越界**：这里只取 menteeProjectId 非空的附件，
 * 个人文档、课题材料、奖状混不进来——七选一 CHECK 保证一份附件只有一个归属。
 */

const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/** 进 ZIP 的文件名不能带路径分隔符和 Windows 保留字符 */
function safeEntrySegment(value: string): string {
  return value.replace(/[\/:*?"<>|]/g, "_").trim() || "_";
}

export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const projectId = form.get("projectId");
  if (typeof projectId !== "string" || projectId === "") {
    return Response.json({ error: "缺少项目标识" }, { status: 400 });
  }

  const project = await prisma.menteeProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      members: {
        orderBy: { orderIndex: "asc" },
        take: 1,
        select: { mentee: { select: { name: true } } },
      },
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
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }
  if (project.attachments.length === 0) {
    return Response.json({ error: "这个项目还没有材料可打包" }, { status: 400 });
  }

  const usedNames = new Set<string>();
  const entries = project.attachments.map((attachment) => {
    let name = safeEntrySegment(attachment.filename);
    // 同名文件（两次上传的「开题报告.docx」）靠 id 前缀分开，不静默覆盖
    if (usedNames.has(name)) {
      name = `${attachment.id.slice(0, 6)}_${name}`;
    }
    usedNames.add(name);
    return {
      name,
      storagePath: attachment.storagePath,
      size: attachment.size,
      mtime: attachment.uploadedAt,
    };
  });

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

  // 先记审计再出流（与奖状包同序）：「记了但下载失败」好过「下载了但没记」
  await logActivity("MenteeProject", project.id, "导出项目材料包", {
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

  const owner = project.members[0]?.mentee.name;
  const filename = `${owner ? `${owner}_` : ""}${project.title}_材料.zip`;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
