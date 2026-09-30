import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getRuleTableYears } from "@/lib/queries/rule-tables";
import { PackImportForm, PasteImportForm } from "./import-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "导入职称表与绩效表" };

type RuleTable = "promotion" | "perf";

const TABLE_LABELS: Record<RuleTable, string> = {
  promotion: "职称量化表",
  perf: "绩效对照表",
};

/**
 * 导入职称表 / 绩效表。两条路：
 * - **粘贴表格**：从学校发的 Excel、WPS、Word 里复制整张表粘进来，指定每一列是什么
 * - **规则包**：同校同事从分类表页「导出规则包」下载的 JSON，直接导
 *
 * 两条路最后走同一个出口（buildPromotionPlan / buildCatalogPlan → lib/rules/apply.ts），
 * 都是先预览、看过再确认才写库；只增改、不删。
 */
export default async function RuleImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const table: RuleTable = params.table === "perf" ? "perf" : "promotion";
  const years = await getRuleTableYears();
  const currentYear = years[table][0] ?? null;
  const defaultYear = currentYear ?? new Date().getFullYear();
  const currentSource =
    table === "promotion" && currentYear != null
      ? ((await prisma.promotionRuleset.findUnique({ where: { year: currentYear }, select: { source: true } }))
          ?.source ?? null)
      : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <Link
          href={`/settings/rules?table=${table}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          职称表与绩效表
        </Link>
        <h1 className="page-title">导入{TABLE_LABELS[table]}</h1>
        <p className="measure text-muted-foreground">
          先看预览，确认了才写进去。
          <span className="text-foreground">导入只增改、不删</span>
          {"——库里有、这次没有的项原样留着；同一年度重导一次就是更新。" +
            "学校发了新一年的表，换个年度导进来，旧的那版留给历史成果用。"}
        </p>
      </header>

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1" aria-label="两张表">
        {(Object.keys(TABLE_LABELS) as RuleTable[]).map((key) => (
          <Link
            key={key}
            href={`/settings/rules/import?table=${key}`}
            aria-current={key === table ? "page" : undefined}
            className="subtab"
          >
            {TABLE_LABELS[key]}
          </Link>
        ))}
      </nav>

      {/* key：换了表就整个重来，免得职称表的列设置带到绩效表上 */}
      <PasteImportForm
        key={`paste-${table}`}
        table={table}
        defaultYear={defaultYear}
        knownYears={years[table]}
        currentSource={currentSource}
      />
      <PackImportForm key={`pack-${table}`} />
    </div>
  );
}
