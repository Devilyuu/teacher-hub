import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AchievementTabs } from "@/components/achievement-tabs";
import { declarationExportInputFingerprint } from "@/lib/export/fingerprint";
import {
  preflightDeclaration,
  type PreflightIssue,
  type PreflightReport,
} from "@/lib/export/preflight";
import { loadDeclarationExportSources } from "@/lib/export/sources";
import { DeclarationExportActions } from "./declaration-export-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "导出" };

/** 可选的申报年度：今年往前两年。再往前的表格式早变了，导出来也对不上 */
function yearOptions(): number[] {
  const thisYear = new Date().getFullYear();
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
          <span className="text-xs text-muted-foreground">这一年还没有挂上分类的成果</span>
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

export default async function ExportPage() {
  const years = yearOptions();

  // 一次取全量，在内存里按年度和口径分别算。成果、课题和课题绩效事项是几百条量级，
  // 为 3 个年度 × 2 个口径各查一次数据库不划算（同 lib/achievement-filters.ts 的做法）
  const { items, profile: profileMeta } = await loadDeclarationExportSources();

  const perYear = years.map((year) => ({
    year,
    promotion: preflightDeclaration(items, year, "promotion"),
    promotionFingerprint: declarationExportInputFingerprint(
      items,
      year,
      "promotion",
      profileMeta,
    ),
    performance: preflightDeclaration(items, year, "performance"),
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
          按年度导出申报表。职称包和绩效包
          <span className="text-foreground">是两套坐标系</span>，各按各的分类和分值出表。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">年度申报表</h2>

        <div className="space-y-3">
          {perYear.map(
            ({
              year,
              promotion,
              promotionFingerprint,
              performance,
              performanceFingerprint,
            }) => (
            <div key={year} className="surface space-y-4 p-5">
              <span className="text-sm font-medium tabular-nums">{year} 年度</span>
              <PreflightPanel
                report={promotion}
                year={year}
                preflightFingerprint={promotionFingerprint}
              />
              <PreflightPanel
                report={performance}
                year={year}
                preflightFingerprint={performanceFingerprint}
              />
            </div>
            ),
          )}
        </div>

        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          默认只导出
          <span className="text-foreground">年度精确匹配、已核实且挂了对应分类</span>
          的成果。职称表看职称二级指标，绩效表看绩效小类。每份安全导出有汇总和明细两张
          sheet；带问题导出会再附一张质量说明。
        </p>
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
            每次下载都会记录类型、年度、覆盖选项、问题摘要和最终行快照，便于之后核对
            「上次实际报了哪些行」。
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
