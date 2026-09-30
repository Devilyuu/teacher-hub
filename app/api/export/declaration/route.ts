import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  buildPerformancePackage,
  buildPromotionPackage,
  filterForDeclaration,
  withPromotionCaps,
} from "@/lib/export/declaration";
import {
  buildDeclarationMaterialPlan,
  type DeclarationMaterialPlan,
} from "@/lib/export/declaration-materials";
import { preflightDeclaration } from "@/lib/export/preflight";
import { declarationExportInputFingerprint } from "@/lib/export/fingerprint";
import { isSameOriginRequest, parseDeclarationRequest } from "@/lib/export/request";
import { buildExportRunData } from "@/lib/export/run";
import { loadDeclarationExportSources } from "@/lib/export/sources";
import { buildDeclarationWorkbook } from "@/lib/export/workbook";
import { sessionGuard } from "@/lib/server-auth";
import { compareIndicatorCode } from "@/lib/promotion";
import { openUploadStream } from "@/lib/storage";
import { zipStream, type ZipSource } from "@/lib/zip";

/** 支撑材料整包上限，和课题材料 ZIP 同一个数。真超了多半是误操作，先拦下来比让浏览器下半小时强 */
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

/**
 * 年度申报包导出（BUILD_PLAN Phase 2 验收目标）。
 *
 * `POST /api/export/declaration` → xlsx；带 `format=zip` 时 → 申报表连同按序号命名的
 * 支撑材料打成的 ZIP（lib/export/declaration-materials.ts）。两种格式走同一条管线、
 * 同一个指纹、同一条 ExportRun，只是最后交出去的东西不同
 *
 * `year` 在绩效表是成果年度，在职称表是**申报年度**（取任现职以来的时间窗，
 * 见 lib/export/declaration.ts 的 `inDeclarationPeriod`）。
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

  if (!isSameOriginRequest(request)) {
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
    format,
  } = parsed;

  let transactionResult:
    | { ok: true; buffer: Buffer; plan: DeclarationMaterialPlan | null }
    | { ok: false; reason: "duplicate" | "drift" }
    | { ok: false; reason: "tooLarge"; totalBytes: number };
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

        const { items, profile: profileMeta, capRules, materials } =
          await loadDeclarationExportSources(tx);
        if (
          declarationExportInputFingerprint(items, year, kind, profileMeta, capRules) !==
          preflightFingerprint
        ) {
          return { ok: false as const, reason: "drift" as const };
        }

        // 职称表的取数范围跟档案里的任现职日期走，和页面预检用的是同一次读出来的值
        // （上面的指纹已经钉住它，预检之后改过档案就当漂移处理）
        const titleSince = profileMeta.currentTitleSince;
        const scoped = filterForDeclaration(items, year, kind, titleSince, options);
        // 职称包的合计要按量化表封顶截一遍，明细照旧写原始分（withPromotionCaps）
        const pkg =
          kind === "promotion"
            ? withPromotionCaps(
                buildPromotionPackage(scoped, year, compareIndicatorCode),
                capRules,
              )
            : buildPerformancePackage(scoped, year);
        const report = preflightDeclaration(items, year, kind, titleSince, options);
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

        // 支撑材料和申报表出自同一个 pkg：编号就是明细表的序号，两边不可能对不上。
        // 规划在事务里做（和成果同一个快照），读盘和打包放到事务之后
        const plan = format === "zip" ? buildDeclarationMaterialPlan(pkg, materials) : null;
        if (plan && plan.totalBytes > MAX_TOTAL_BYTES) {
          return { ok: false as const, reason: "tooLarge" as const, totalBytes: plan.totalBytes };
        }

        const run = buildExportRunData({
          requestKey,
          kind,
          year,
          options,
          issues: includedIssues,
          groups: pkg.groups,
          format,
          materials: plan?.entries,
        });
        await tx.exportRun.create({ data: run });

        return { ok: true as const, buffer, plan };
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
    if (transactionResult.reason === "tooLarge") {
      return Response.json(
        {
          error: `支撑材料一共 ${Math.round(transactionResult.totalBytes / 1024 / 1024)}MB，超过 ${
            MAX_TOTAL_BYTES / 1024 / 1024
          }MB 上限。先只下载申报表，材料到各条成果里分别下载`,
        },
        { status: 413 },
      );
    }
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

  // 职称表的年份是申报年度，里面装的是之前好几年的成果，别叫「2027年度」
  const filename =
    kind === "promotion" ? `${year}年申报职称量化表.xlsx` : `${year}年度绩效申报表.xlsx`;

  if (transactionResult.plan) {
    return declarationZipResponse(
      filename,
      transactionResult.buffer,
      transactionResult.plan,
      kind === "promotion" ? `${year}年申报职称量化申报包.zip` : `${year}年度绩效申报包.zip`,
    );
  }

  return new Response(new Uint8Array(transactionResult.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 文件名带中文，必须用 filename* 的 RFC 5987 写法，否则浏览器存成乱码
      "Content-Disposition": `attachment; filename="declaration.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/**
 * 申报包 ZIP：根目录一张申报表，`支撑材料/` 下是按序号命名的附件。
 *
 * **流式生成**，同课题材料 ZIP：附件逐块读出直接写进响应，内存里只有 64KB 级别的块。
 * 中途读盘失败就让连接以错误收场——浏览器当成下载失败，而不是留下一个截断的包
 */
function declarationZipResponse(
  workbookName: string,
  workbook: Buffer,
  plan: DeclarationMaterialPlan,
  zipName: string,
): Response {
  const zipSources: ZipSource[] = [
    {
      name: workbookName,
      mtime: new Date(),
      read: async function* () {
        yield new Uint8Array(workbook);
      },
    },
    ...plan.entries.map((entry) => ({
      name: entry.name,
      mtime: entry.uploadedAt,
      read: openUploadStream(entry.storagePath),
    })),
  ];

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

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      // 不设 Content-Length：流式生成时总长度打完包才知道，设错了浏览器会按错的长度截断
      "Content-Disposition": `attachment; filename="declaration.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
