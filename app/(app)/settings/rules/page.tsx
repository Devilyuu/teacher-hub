import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ClipboardPaste, Download, FileJson } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { buttonVariants } from "@/components/ui/button";
import { hasProjectEligible } from "@/lib/project-eligibility";
import { getPerfTable, getPromotionTable, getRuleTableYears } from "@/lib/queries/rule-tables";
import { cn } from "@/lib/utils";
import {
  AddCategory,
  DeleteWholeTable,
  PerfTablePanel,
  PromotionTablePanel,
  RulesetHeadEditor,
} from "./rules-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "职称表与绩效表" };

type RuleTable = "promotion" | "perf";

const TABLE_LABELS: Record<RuleTable, string> = {
  promotion: "职称量化表",
  perf: "绩效对照表",
};

/**
 * 设置 → 职称表与绩效表。
 *
 * 每所学校的表不一样（2026-09-27 为给别的老师用而做）：这里能看、能一条条改、
 * 能整组改名，导入走旁边的 /settings/rules/import（粘贴表格、规则包）。
 * 两张表是两套坐标系（CLAUDE.md 第 11 条），各占一个 tab，互不换算。
 *
 * **最大的那个年度是「当前在用」**：录入界面的下拉只列它；旧年度留着，历史成果仍按当年的表解释。
 */
export default async function RuleTablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const table: RuleTable = params.table === "perf" ? "perf" : "promotion";
  const years = await getRuleTableYears();
  const tableYears = years[table];
  const requested = Number(typeof params.year === "string" ? params.year : NaN);
  const year = tableYears.includes(requested) ? requested : (tableYears[0] ?? null);
  const currentYear = tableYears[0] ?? null;

  const promotion = table === "promotion" && year != null ? await getPromotionTable(year) : null;
  const perf = table === "perf" && year != null ? await getPerfTable(year) : null;
  const rowCount = promotion?.categories.length ?? perf?.length ?? 0;
  const eligibleRows = promotion?.categories ?? perf ?? [];
  const linkedTotal = promotion
    ? promotion.categories.reduce((sum, row) => sum + row.achievementCount + row.projectCount, 0)
    : (perf ?? []).reduce((sum, row) => sum + row.achievementCount + row.eventCount, 0);
  const majors = [
    ...new Set(promotion ? promotion.categories.map((row) => row.majorIndicator) : (perf ?? []).map((row) => row.majorCategory)),
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          设置
        </Link>
        <h1 className="page-title">职称表与绩效表</h1>
        <p className="measure text-muted-foreground">
          {"每所学校的职称评审量化表、绩效对照表都不一样。把学校的表导进来，成果和课题就能挂上分类，导出页按它出申报表。"}
          <span className="text-foreground">系统只存规则原文、只按上限算合计，分数照旧人工填。</span>
        </p>
      </header>

      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b px-1" aria-label="两张表">
        {(Object.keys(TABLE_LABELS) as RuleTable[]).map((key) => (
          <Link
            key={key}
            href={`/settings/rules?table=${key}`}
            aria-current={key === table ? "page" : undefined}
            className="subtab"
          >
            {TABLE_LABELS[key]}
          </Link>
        ))}
      </nav>

      {year == null ? (
        <section className="space-y-4 rounded-2xl bg-well px-6 py-10 text-center">
          <ClipboardArt className="mx-auto size-12 text-muted-foreground" />
          <div className="mx-auto max-w-measure space-y-2">
            <p className="text-sm font-medium">还没有{TABLE_LABELS[table]}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {"打开学校发的 Excel 或 Word，把整张表选中、复制，粘贴进来就行——合并单元格、没有编号的表都认。" +
                "同事已经整理过的话，让他从这里「导出规则包」发给你，直接导入。"}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/settings/rules/import?table=${table}`} className={buttonVariants({ size: "sm" })}>
              <ClipboardPaste className="size-3.5" aria-hidden />
              粘贴表格导入
            </Link>
            <Link
              href={`/settings/rules/import?table=${table}#pack`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <FileJson className="size-3.5" aria-hidden />
              导入规则包
            </Link>
          </div>
          <div className="mx-auto max-w-xl text-left">
            <AddCategory table={table} year={null} majors={[]} label="一条条手工添加" />
          </div>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {tableYears.map((value) => (
                    <Link
                      key={value}
                      href={`/settings/rules?table=${table}&year=${value}`}
                      aria-current={value === year ? "page" : undefined}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs tabular-nums",
                        value === year
                          ? "bg-primary font-medium text-primary-foreground"
                          : "bg-well text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {value} 版{value === currentYear ? " · 当前在用" : ""}
                    </Link>
                  ))}
                  <span className="text-xs text-muted-foreground tabular-nums">{rowCount} 项</span>
                </div>
                {year !== currentYear ? (
                  <p className="measure text-xs text-muted-foreground">
                    这是旧版本。录入成果、课题时下拉里只有 {currentYear} 版；{year} 版只给挂在它上面的历史成果用。
                  </p>
                ) : null}
                {promotion?.ruleset ? (
                  <p className="measure truncate text-xs text-muted-foreground" title={promotion.ruleset.source}>
                    出处：{promotion.ruleset.source}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/settings/rules/import?table=${table}#pack`}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  <FileJson className="size-3.5" aria-hidden />
                  导入规则包
                </Link>
                {/* 规则包是给同校同事直接导入的，格式就是导入格式（lib/rules/pack.ts） */}
                <a
                  href={`/api/rules/export?table=${table}&year=${year}`}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  <Download className="size-3.5" aria-hidden />
                  导出规则包
                </a>
                <Link href={`/settings/rules/import?table=${table}`} className={buttonVariants({ size: "sm" })}>
                  <ClipboardPaste className="size-3.5" aria-hidden />
                  粘贴导入
                </Link>
              </div>
            </div>

            <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
              {hasProjectEligible(eligibleRows) ? (
                <>
                  勾了「课题可挂」的
                  <span className="text-foreground">{` ${eligibleRows.filter((row) => row.projectEligible).length} 项`}</span>
                  会出现在{table === "promotion" ? "课题表单的职称指标" : "课题详情的「课题绩效事项」"}里。
                </>
              ) : (
                <>
                  还没有哪一项勾「课题可挂」，所以
                  {table === "promotion" ? "课题表单的职称指标" : "课题详情的「课题绩效事项」"}
                  里会列出全部 {rowCount} 项。给课题实际会挂的那一两项（比如纵向、横向课题）勾上，下拉就只剩它们。
                </>
              )}
            </p>

            <AddCategory table={table} year={year} majors={majors} label="添加一项" />
          </section>

          {promotion ? <PromotionTablePanel year={year} rows={promotion.categories.map(serializeRow)} /> : null}
          {perf ? <PerfTablePanel year={year} rows={perf.map(serializeRow)} /> : null}

          {promotion ? (
            <RulesetHeadEditor
              year={year}
              source={promotion.ruleset?.source ?? ""}
              generalNotes={promotion.ruleset?.generalNotes ?? []}
              dataVersion={promotion.ruleset?.updatedAt.toISOString() ?? "none"}
            />
          ) : null}

          <DeleteWholeTable
            table={table}
            year={year}
            label={`${TABLE_LABELS[table]} ${year} 版`}
            rowCount={rowCount}
            linkedTotal={linkedTotal}
            isCurrent={year === currentYear}
          />
        </>
      )}
    </div>
  );
}

/** Date 过不了 Server → Client 边界的序列化也行，但版本号要字符串比较，统一转一下 */
function serializeRow<T extends { updatedAt: Date }>(row: T): Omit<T, "updatedAt"> & { updatedAt: string } {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}
