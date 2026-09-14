import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  buildPerformancePackage,
  buildPromotionPackage,
  filterForDeclaration,
} from "@/lib/export/declaration";
import { preflightDeclaration } from "@/lib/export/preflight";
import { declarationExportInputFingerprint } from "@/lib/export/fingerprint";
import { isSameOrigin, parseDeclarationRequest } from "@/lib/export/request";
import { buildExportRunData } from "@/lib/export/run";
import { loadDeclarationExportSources } from "@/lib/export/sources";
import { buildDeclarationWorkbook } from "@/lib/export/workbook";
import { sessionGuard } from "@/lib/server-auth";
import { compareIndicatorCode } from "@/lib/promotion";

/**
 * 年度申报包导出（BUILD_PLAN Phase 2 验收目标）。
 *
 * `POST /api/export/declaration` → xlsx
 *
 * 覆盖默认集合时还需 includeUnverified / includeMissingYear 与 confirmIssues=true。
 *
 * 走 Route Handler 而不是 Server Action：要返回一个文件流，
 * 而 Server Action 的返回值是序列化过的 JS 值，塞不了二进制。
 */
export async function POST(request: Request) {
  // 这是个公开端点，自己验会话——「入口只在登录后的页面上」不构成安全边界
  const denied = await sessionGuard();
  if (denied) return denied;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl, request.headers.get("origin"))) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const parsed = parseDeclarationRequest(await request.formData());
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const {
    kind,
    year,
    options,
    isOverride,
    preflightFingerprint,
    requestKey,
  } = parsed;

  let transactionResult:
    | { ok: true; buffer: Buffer }
    | { ok: false; reason: "duplicate" | "drift" };
  try {
    transactionResult = await prisma.$transaction(
      async (tx) => {
        if (
          await tx.exportRun.findUnique({
            where: { requestKey },
            select: { id: true },
          })
        ) {
          return { ok: false as const, reason: "duplicate" as const };
        }

        const { items, profile: profileMeta } =
          await loadDeclarationExportSources(tx);
        if (
          declarationExportInputFingerprint(items, year, kind, profileMeta) !==
          preflightFingerprint
        ) {
          return { ok: false as const, reason: "drift" as const };
        }

        const scoped = filterForDeclaration(items, year, kind, options);
        const pkg =
          kind === "promotion"
            ? buildPromotionPackage(scoped, year, compareIndicatorCode)
            : buildPerformancePackage(scoped, year);
        const report = preflightDeclaration(items, year, kind, options);
        const includedIssues = report.issues.filter(
          (issue) => issue.scope === "included",
        );
        const overriddenIssues = includedIssues.filter(
          (issue) =>
            (issue.code === "unverified" && options.includeUnverified) ||
            (issue.code === "missingYear" && options.includeMissingYear),
        );
        const buffer = await buildDeclarationWorkbook(
          pkg,
          profileMeta,
          isOverride
            ? {
                issues: overriddenIssues.map((issue) => ({
                  code: issue.code,
                  label: issue.label,
                  count: issue.count,
                  detail: issue.hint,
                })),
              }
            : undefined,
        );

        const run = buildExportRunData({
          requestKey,
          kind,
          year,
          options,
          issues: includedIssues,
          groups: pkg.groups,
        });
        await tx.exportRun.create({ data: run });

        return { ok: true as const, buffer };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "这次导出请求已经处理，请刷新页面后重试" }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return Response.json(
        { error: "导出期间数据发生并发变化，请刷新页面后重试" },
        { status: 409 },
      );
    }
    throw error;
  }

  if (!transactionResult.ok) {
    return Response.json(
      {
        error:
          transactionResult.reason === "duplicate"
            ? "这次导出请求已经处理，请刷新页面后重试"
            : "成果数据在预检后发生变化，请刷新导出页并重新确认",
      },
      { status: 409 },
    );
  }

  const filename = `${year}年度${kind === "promotion" ? "职称量化" : "绩效"}申报表.xlsx`;
  return new Response(new Uint8Array(transactionResult.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 文件名带中文，必须用 filename* 的 RFC 5987 写法，否则浏览器存成乱码
      "Content-Disposition": `attachment; filename="declaration.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
