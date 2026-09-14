import { prisma } from "@/lib/db";
import { buildCloseoutDocument } from "@/lib/export/closeout";
import { buildCloseoutDocx } from "@/lib/export/closeout-docx";
import { loadCloseoutInput } from "@/lib/export/closeout-sources";
import { isSameOrigin } from "@/lib/export/request";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 结题清单 Word（规格 7.4 / 增量 3.2）。
 *
 * `POST /api/export/project-closeout` → docx
 *
 * 内容全部由 `buildCloseoutDocument` 决定：课题、结题要求、**已人工确认达标**的
 * 成果、以及与材料 ZIP 同号的材料目录。系统只汇总，不判定谁算达标
 * （CLAUDE.md 第 1 条）。
 *
 * 与申报表导出不同，这里**不做预检也不做指纹**：那套是为了拦住「未核实、缺年度
 * 的记录混进申报包」，而结题清单是把当前状态如实抄一份出来——缺口没补上正是它
 * 要显示的东西，不该拦。
 */
export async function POST(request: Request) {
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

  const input = await loadCloseoutInput(projectId);
  if (!input) {
    return Response.json({ error: "课题不存在" }, { status: 404 });
  }

  const document = buildCloseoutDocument(input);
  // 先出文件、成功后才记审计：和申报表导出同一条规矩，
  // 生成失败时不该留下一条「导出过」的记录
  const buffer = await buildCloseoutDocx(document);

  await prisma.exportRun.create({
    data: {
      kind: "PROJECT_CLOSEOUT",
      projectId,
      options: {},
      includedCount: document.requirements.length,
      issueSummary:
        document.summary.totalGap > 0
          ? [{ code: "gap", count: document.summary.totalGap }]
          : [],
      // 快照存当次清单的关键行。底层成果和材料之后都会变，
      // 只有行快照能回答「上次交出去的那份清单写了什么」
      snapshot: {
        heading: document.heading,
        summary: document.summary,
        requirements: document.requirements.map((requirement) => ({
          index: requirement.index,
          requiredCount: requirement.requiredCount,
          qualifiedCount: requirement.qualifiedCount,
          gap: requirement.gap,
          qualified: requirement.qualified.map((item) => item.title),
          materials: requirement.materials.map((material) => material.no),
        })),
        materialIndex: document.materialIndex.map((material) => ({
          no: material.no,
          filename: material.filename,
          source: material.source,
        })),
      },
    },
  });

  const filename = `${input.project.code ? `${input.project.code}_` : ""}${
    input.project.shortTitle ?? input.project.title
  }_结题材料清单.docx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
