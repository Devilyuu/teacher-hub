"use client";

import { useState, type FormEvent } from "react";
import { Download, FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PreflightReport } from "@/lib/export/preflight";

const KIND_LABELS = {
  promotion: "职称量化表",
  performance: "绩效申报表",
} as const;

export function DeclarationExportActions({
  report,
  year,
  preflightFingerprint,
}: {
  report: PreflightReport;
  year: number;
  preflightFingerprint: string;
}) {
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [includeMissingYear, setIncludeMissingYear] = useState(false);
  // 连同支撑材料打成 ZIP。两个表单共用这一个开关：带问题导出时同样要材料
  const [withMaterials, setWithMaterials] = useState(false);
  const label = KIND_LABELS[report.kind];
  const unverifiedCount =
    report.issues.find((issue) => issue.code === "unverified" && issue.scope === "excluded")
      ?.count ?? 0;
  const missingYearCount =
    report.issues.find((issue) => issue.code === "missingYear" && issue.scope === "excluded")
      ?.count ?? 0;
  const hasOverrideChoices = unverifiedCount > 0 || missingYearCount > 0;
  const hasSelection = includeUnverified || includeMissingYear;
  const combination =
    includeUnverified && includeMissingYear
      ? "includeBoth"
      : includeUnverified
        ? "includeUnverified"
        : includeMissingYear
          ? "includeMissingYear"
          : "safe";
  const selectedCount = report.includedCounts[combination];
  const selectedMaterialCount = report.materialCounts[combination];
  // 四种组合里「都放进来」那种材料最多；它也是 0 就没什么可打包的
  const anyMaterials = report.materialCounts.includeBoth > 0;

  function setFreshRequestKey(form: HTMLFormElement) {
    const field = form.elements.namedItem("requestKey");
    if (field instanceof HTMLInputElement) field.value = crypto.randomUUID();
  }

  function prepareSafeExport(event: FormEvent<HTMLFormElement>) {
    setFreshRequestKey(event.currentTarget);
  }

  function confirmProblemExport(event: FormEvent<HTMLFormElement>) {
    if (!hasSelection) {
      event.preventDefault();
      return;
    }
    setFreshRequestKey(event.currentTarget);

    const selected = [
      includeUnverified ? `允许纳入未核实成果（检测到 ${unverifiedCount} 条）` : null,
      includeMissingYear ? `允许纳入未分配年度成果（检测到 ${missingYearCount} 条）` : null,
    ].filter(Boolean);
    // 职称表的 year 是申报年度，写成「2027 年职称量化表」会被读成 2027 年的成果
    const target =
      report.kind === "promotion" ? `按 ${year} 年申报的${label}` : ` ${year} 年${label}`;
    const packing = withMaterials
      ? `\n连同 ${selectedMaterialCount} 份支撑材料打成 ZIP，文件按明细表序号命名。`
      : "";
    if (
      !window.confirm(
        `确认带问题导出${target}？\n\n${selected.join("、")}。\n按当前数据最终会导出 ${selectedCount} 条，工作簿会附上“质量说明”。${packing}`,
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action="/api/export/declaration" method="post" onSubmit={prepareSafeExport}>
        <input type="hidden" name="kind" value={report.kind} />
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="preflightFingerprint" value={preflightFingerprint} />
        <input type="hidden" name="requestKey" value="" />
        <input type="hidden" name="format" value={withMaterials ? "zip" : "xlsx"} />
        <Button type="submit" variant="outline" size="sm">
          {withMaterials ? (
            <FileArchive className="size-3.5" aria-hidden />
          ) : (
            <Download className="size-3.5" aria-hidden />
          )}
          {label}
          <span className="ml-1 tabular-nums text-muted-foreground">{report.includedCount}</span>
        </Button>
      </form>

      {/* 申报包 = 申报表 + 按序号命名的支撑材料（prd-ledger 4.2）。
          数字是默认导出那几条的材料份数，和明细表「材料份数」一列相加对得上 */}
      {anyMaterials ? (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={withMaterials}
            onChange={(event) => setWithMaterials(event.target.checked)}
            className="size-3.5 accent-foreground"
          />
          连同支撑材料打包（{report.materialCounts.safe} 份）
        </label>
      ) : null}

      {hasOverrideChoices ? (
        <form
          action="/api/export/declaration"
          method="post"
          className="flex flex-wrap items-center gap-2"
          onSubmit={confirmProblemExport}
        >
          <input type="hidden" name="kind" value={report.kind} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="confirmIssues" value="true" />
          <input type="hidden" name="preflightFingerprint" value={preflightFingerprint} />
          <input type="hidden" name="requestKey" value="" />
          <input type="hidden" name="format" value={withMaterials ? "zip" : "xlsx"} />

          {unverifiedCount > 0 ? (
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="includeUnverified"
                value="true"
                checked={includeUnverified}
                onChange={(event) => setIncludeUnverified(event.target.checked)}
                className="size-3.5 accent-foreground"
              />
              允许未核实（检测到 {unverifiedCount}）
            </label>
          ) : null}

          {missingYearCount > 0 ? (
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                name="includeMissingYear"
                value="true"
                checked={includeMissingYear}
                onChange={(event) => setIncludeMissingYear(event.target.checked)}
                className="size-3.5 accent-foreground"
              />
              允许未分配年度（检测到 {missingYearCount}）
            </label>
          ) : null}

          <Button type="submit" variant="destructive" size="sm" disabled={!hasSelection}>
            <Download className="size-3.5" aria-hidden />
            带问题导出
          </Button>
          {hasSelection ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              最终 {selectedCount} 条
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
