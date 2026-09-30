import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AchievementTabs } from "@/components/achievement-tabs";
import { FolderArt } from "@/components/empty-art";
import { FilterChip } from "@/components/filter-chip";
import { formatDateOnly } from "@/lib/date";
import { formatTimestamp } from "@/lib/format";
import { getRecentExportRuns } from "@/lib/queries/export-runs";
import {
  buildPromotionPackage,
  filterForDeclaration,
  withPromotionCaps,
} from "@/lib/export/declaration";
import { declarationExportInputFingerprint } from "@/lib/export/fingerprint";
import {
  preflightDeclaration,
  type PreflightIssue,
  type PreflightReport,
} from "@/lib/export/preflight";
import { loadDeclarationExportSources } from "@/lib/export/sources";
import {
  compareIndicatorCode,
  defaultPromotionDeclareYear,
  parsePromotionDeclareYear,
  promotionDeclareYearOptions,
  promotionWindow,
} from "@/lib/promotion";
import { DeclarationExportActions } from "./declaration-export-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "导出" };

/** 绩效表可选的年度：今年往前两年。再往前的表格式早变了，导出来也对不上 */
function performanceYearOptions(thisYear: number): number[] {
  return [thisYear, thisYear - 1, thisYear - 2];
}

function IssueRow({ issue }: { issue: PreflightIssue }) {
  return (
    <div className="space-y-1.5 border-b border-border/40 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{issue.label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{issue.count} 条</span>
        {issue.scope === "excluded" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            不在表里
          </span>
        ) : null}
      </div>

      <p className="measure text-xs leading-relaxed text-muted-foreground">{issue.hint}</p>

      <p className="measure text-xs leading-relaxed text-muted-foreground">
        {issue.samples.map((sample, i) => (
          <span key={`${sample.sourceKind}:${sample.sourceId}`}>
            {i > 0 ? "、" : null}
            <Link
              href={sample.href}
              className="underline decoration-border underline-offset-4 hover:text-foreground"
            >
              {sample.title}
            </Link>
          </span>
        ))}
        {issue.count > issue.samples.length ? (
          <span> 等 {issue.count} 条</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * 一份包的预检结果。
 *
 * 干净时只有一行「N 条，没发现问题」——**没问题时不该占版面**，
 * 否则每年两块空面板会把真正有问题的那块淹掉。
 */
function PreflightPanel({
  report,
  year,
  preflightFingerprint,
}: {
  report: PreflightReport;
  year: number;
  preflightFingerprint: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DeclarationExportActions
          report={report}
          year={year}
          preflightFingerprint={preflightFingerprint}
        />

        {report.includedCount === 0 && report.issues.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {report.kind === "promotion"
              ? "时间窗里还没有挂上职称指标的课题或成果"
              : "这一年还没有挂上分类的成果"}
          </span>
        ) : report.issues.length === 0 ? (
          <span className="text-xs text-muted-foreground">没发现问题</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            <span className="text-foreground tabular-nums">{report.flaggedCount}</span> 条待处理
            {report.issues.some((i) => i.scope === "excluded") ? "，另有条目没进表" : null}
          </span>
        )}
      </div>

      {report.issues.length > 0 ? (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">看看是哪些</span>
            <span className="hidden group-open:inline">收起</span>
            {/* 原生 marker 被 list-none 去掉了，补一个会转身的箭头当开合指示 */}
            <ChevronDown
              className="size-3 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-1">
            {report.issues.map((issue) => (
              <IssueRow key={issue.code} issue={issue} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ dyear?: string | string[] }>;
}) {
  const thisYear = new Date().getFullYear();
  const { dyear } = await searchParams;
  // 申报年度的可选项和默认值与成果页职称口径同一份（lib/promotion.ts）：
  // 从成果页点过来，看到的必须是同一批东西
  const declareYear = parsePromotionDeclareYear(
    typeof dyear === "string" ? dyear : null,
    thisYear,
  );

  // 一次取全量，在内存里按年度和口径分别算。成果、课题和课题绩效事项是几百条量级，
  // 为几个年度 × 2 个口径各查一次数据库不划算（成果页 lib/outcomes/filters.ts 也是这么做的）
  const [{ items, profile: profileMeta, capRules }, recent] = await Promise.all([
    loadDeclarationExportSources(),
    getRecentExportRuns(),
  ]);
  const titleSince = profileMeta.currentTitleSince;
  const window = promotionWindow(titleSince, declareYear);

  const promotion = preflightDeclaration(items, declareYear, "promotion", titleSince);
  const promotionFingerprint = declarationExportInputFingerprint(
    items,
    declareYear,
    "promotion",
    profileMeta,
    capRules,
  );
  // 默认（安全）导出那一份的封顶核算，和接口走同一条管线：筛选 → 组表 → 封顶
  const promotionCaps = withPromotionCaps(
    buildPromotionPackage(
      filterForDeclaration(items, declareYear, "promotion", titleSince),
      declareYear,
      compareIndicatorCode,
    ),
    capRules,
  ).caps;

  const perYear = performanceYearOptions(thisYear).map((year) => ({
    year,
    performance: preflightDeclaration(items, year, "performance", titleSince),
    performanceFingerprint: declarationExportInputFingerprint(
      items,
      year,
      "performance",
      profileMeta,
    ),
  }));

  return (
    <div className="space-y-6">
      <AchievementTabs />

      <header className="space-y-2 pt-2">
        <h1 className="page-title">导出</h1>
        <p className="measure text-muted-foreground">
          {/* 中文分行写会在 JSX 里折成一个空格，逗号后面凭空多一格，所以这句不换行 */}
          职称表和绩效表<span className="text-foreground">是两套坐标系</span>，各按各的分类和分值出表，取数范围也不一样：职称表按申报年度取任现职以来的成果，绩效表按成果年度一年一张。
        </p>
      </header>

      {/* 职称表只有一张：时间窗跨好几年，按年度并排摆三张的话三张里大半是同一批东西 */}
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">职称量化表</h2>

        <div className="surface space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pr-1 text-xs text-muted-foreground">申报年度</span>
            {promotionDeclareYearOptions(thisYear).map((year) => (
              <FilterChip
                key={year}
                active={declareYear === year}
                href={
                  year === defaultPromotionDeclareYear(thisYear)
                    ? "/export"
                    : `/export?dyear=${year}`
                }
              >
                {year}
              </FilterChip>
            ))}
          </div>

          <p className="measure text-xs leading-relaxed text-muted-foreground">
            按 {declareYear} 年申报，取
            {window.from ? (
              <span className="text-foreground tabular-nums">
                {" "}
                {formatDateOnly(window.from)} 至 {window.toYear}-12-31{" "}
              </span>
            ) : (
              <span className="text-foreground tabular-nums"> {window.toYear}-12-31 以前 </span>
            )}
            的课题和成果（附件2 说明第 2 条：申报当年的不算）。
            {window.from ? null : (
              <>
                档案里还没填现职称取得日期，所以没有起点，任现职之前的也会算进来——
                <Link href="/profile" className="text-foreground underline underline-offset-4">
                  去档案里填上
                </Link>
                。
              </>
            )}
          </p>

          {promotionCaps && promotion.includedCount > 0 ? (
            <p className="measure text-xs leading-relaxed text-muted-foreground">
              默认导出的 {promotion.includedCount} 条，按量化表封顶后合计{" "}
              <span className="font-medium tabular-nums text-foreground">
                {promotionCaps.cappedTotal}
              </span>{" "}
              分
              {promotionCaps.overCap.length > 0 ? (
                <>
                  （原始 <span className="tabular-nums">{promotionCaps.rawTotal}</span> 分）。超出上限不计入：
                  {promotionCaps.overCap
                    .map((over) => `${over.label} 合计 ${over.raw} 分、上限 ${over.cap} 分`)
                    .join("；")}
                  。表里逐条照旧写原始分，汇总表另起一行写封顶后合计。
                </>
              ) : (
                "，没有超出上限的栏。"
              )}
            </p>
          ) : null}

          <PreflightPanel
            report={promotion}
            year={declareYear}
            preflightFingerprint={promotionFingerprint}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">年度绩效表</h2>

        <div className="space-y-3">
          {perYear.map(({ year, performance, performanceFingerprint }) => (
            <div key={year} className="surface space-y-4 p-5">
              <span className="text-sm font-medium tabular-nums">{year} 年度</span>
              <PreflightPanel
                report={performance}
                year={year}
                preflightFingerprint={performanceFingerprint}
              />
            </div>
          ))}
        </div>

        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          默认只导出
          <span className="text-foreground">落在取数范围里、已核实且挂了对应分类</span>
          的成果。职称表看职称二级指标，绩效表看绩效小类。每份安全导出有汇总和明细两张
          sheet；带问题导出会再附一张质量说明。
        </p>
        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          勾上<span className="text-foreground">「连同支撑材料打包」</span>下载的是一个 ZIP：
          根目录是那张申报表，「支撑材料」目录里的文件按明细表的序号命名（第 3 行的就是 03-1、03-2…），
          和「材料份数」一列一一对得上。课题的绩效事项带的是所属课题的材料；研究参考不进包。
        </p>
      </section>

      {/* 「每次下载都会记录……便于之后核对上次实际报了哪些行」——这句话写了两个月，
          记录一直在存，却没有任何地方能看（2026-09-25 评审第 4 条）。文案承诺的事界面上必须做得到 */}
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">最近导出</h2>
        {recent.runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
            <FolderArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              还没有导出过。每次下载申报表、课题材料或结题清单都会记在这里。
            </p>
          </div>
        ) : (
          <>
            <ul className="surface divide-y divide-border/60">
              {recent.runs.map((run) => (
                <li key={run.id} className="space-y-1 px-5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {run.href ? (
                      <Link
                        href={run.href}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {run.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{run.title}</span>
                    )}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatTimestamp(run.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      run.formatLabel,
                      `${run.includedCount} 条`,
                      run.overrides.length > 0 ? `带问题导出：${run.overrides.join("、")}` : null,
                      run.issues.length > 0 ? `当时仍带：${run.issues.join("、")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
            {recent.total > recent.runs.length ? (
              <p className="px-1 text-xs text-muted-foreground">
                只列最近 {recent.runs.length} 次，一共导出过{" "}
                <span className="tabular-nums">{recent.total}</span> 次。
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">关于上面那些提示</h2>
        {/* 卡片照旧占满宽度，只把里面的文字收窄——把卡片本身缩到 42rem
            会和上下几张满宽的卡参差不齐 */}
        <div className="surface space-y-2 p-5 text-xs leading-relaxed text-muted-foreground [&>p]:max-w-measure">
          <p>
            <span className="text-foreground">安全导出始终可以直接下载。</span>
            未核实或未分配年度的成果默认不进表；确需纳入时，勾选具体覆盖项并点击「带问题导出」。
          </p>
          <p>
            标着<span className="text-foreground">「不在表里」</span>
            的那类要单独看一眼：它说的不是表里的数据脏，而是你以为报上去了、其实这条压根没进表。
          </p>
          <p>
            每次下载都会记录类型、年度、覆盖选项、问题摘要和最终行快照（打包时连同每行附了哪些文件），
            在上面「最近导出」里点开申报表那一条，就是当时实际报上去的那些行。
          </p>
        </div>
      </section>

      {/* 这一段原来叫「还没做的」，列的三项（材料 ZIP、结题清单 Word、
          全库 JSON 备份）三期都已上线。留着过期的路线图比不写还糟：
          它会让人以为功能不存在，转身去别处找。改成指路——
          这三样确实都不在本页，各有各的入口 */}
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">不在这一页的导出</h2>
        <div className="surface space-y-2 p-5 text-sm text-muted-foreground [&>p]:max-w-measure">
          <p>· 课题材料 ZIP、结题材料清单 Word —— 在课题详情里，按单个课题打包</p>
          <p>· 全库 JSON 备份 —— 在设置页，一次搬走全部业务数据</p>
        </div>
      </section>
    </div>
  );
}
