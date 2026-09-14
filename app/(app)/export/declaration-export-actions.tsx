"use client";

import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
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
  const label = KIND_LABELS[report.kind];
  const unverifiedCount =
    report.issues.find((issue) => issue.code === "unverified" && issue.scope === "excluded")
      ?.count ?? 0;
  const missingYearCount =
    report.issues.find((issue) => issue.code === "missingYear" && issue.scope === "excluded")
      ?.count ?? 0;
  const hasOverrideChoices = unverifiedCount > 0 || missingYearCount > 0;
  const hasSelection = includeUnverified || includeMissingYear;
  const selectedCount =
    includeUnverified && includeMissingYear
      ? report.includedCounts.includeBoth
      : includeUnverified
        ? report.includedCounts.includeUnverified
        : includeMissingYear
          ? report.includedCounts.includeMissingYear
          : report.includedCounts.safe;

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
    if (
      !window.confirm(
        `确认带问题导出 ${year} 年${label}？\n\n${selected.join("、")}。\n按当前数据最终会导出 ${selectedCount} 条，工作簿会附上“质量说明”。`,
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
        <Button type="submit" variant="outline" size="sm">
          <Download className="size-3.5" aria-hidden />
          {label}
          <span className="ml-1 tabular-nums opacity-70">{report.includedCount}</span>
        </Button>
      </form>

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
