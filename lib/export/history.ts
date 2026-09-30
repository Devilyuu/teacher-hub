/**
 * 导出历史（`ExportRun`）的展示口径。纯函数，查询在 `lib/queries/export-runs.ts`。
 *
 * 存在的理由是导出页那句承诺：「每次下载都会记录……便于之后核对上次实际报了哪些行」。
 * 记录从 2026-07 起就在写，却一直没有任何地方能看——文案承诺的事界面上必须做得到
 * （CLAUDE.md 视觉语言「删除分两种模型」那条的同一个道理）。
 *
 * 快照是 JSON，写入方随版本变过（2026-09-26 起申报表多记 `format` 和每行的 `materials`），
 * 所以这里一律**宽松解析**：认得的字段拿出来，缺的按旧版本的含义补，认不出的行跳过，不抛错。
 */

import type { ExportKind } from "@/lib/generated/prisma/enums";
import { EXPORT_KIND_LABELS } from "@/lib/labels";

export type ExportRunSummary = {
  id: string;
  kind: ExportKind;
  year: number | null;
  projectId: string | null;
  options: unknown;
  includedCount: number;
  issueSummary: unknown;
  createdAt: Date;
};

export type ExportRunView = {
  id: string;
  /** 「2027 年申报 · 职称量化表」「结题清单 · 某课题」 */
  title: string;
  /** 「申报表」「申报包 ZIP」；课题那两种不写 */
  formatLabel: string | null;
  /** 带问题导出时覆盖了哪些默认：「含未核实」「含没填年度」 */
  overrides: string[];
  /** 当次导出里仍带着的问题，「没有支撑材料 3」 */
  issues: string[];
  includedCount: number;
  /** 点进去看什么：申报表看当次的行快照，课题那两种回课题详情 */
  href: string | null;
  createdAt: Date;
};

/** 申报表问题代码 → 界面叫法。和导出预检 `preflight.ts` 的标题同一套说法 */
const ISSUE_LABELS: Record<string, string> = {
  unverified: "未核实",
  missingYear: "没填年度",
  missingScore: "没填分",
  missingMaterial: "没有支撑材料",
  suspiciousStatus: "状态存疑",
  gap: "缺口",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/** 申报表那两种的 options。没有 `format` 的是 09-26 以前的记录，那时只有 xlsx */
export function parseDeclarationRunOptions(options: unknown): {
  includeUnverified: boolean;
  includeMissingYear: boolean;
  format: "xlsx" | "zip";
} {
  const record = isRecord(options) ? options : {};
  return {
    includeUnverified: record.includeUnverified === true,
    includeMissingYear: record.includeMissingYear === true,
    format: record.format === "zip" ? "zip" : "xlsx",
  };
}

function issueLines(issueSummary: unknown): string[] {
  if (!Array.isArray(issueSummary)) return [];
  return issueSummary.flatMap((issue) =>
    isRecord(issue) && typeof issue.code === "string" && typeof issue.count === "number" && issue.count > 0
      ? [`${ISSUE_LABELS[issue.code] ?? issue.code} ${issue.count}`]
      : [],
  );
}

export function isDeclarationRun(kind: ExportKind): boolean {
  return kind === "PERF_DECLARATION" || kind === "PROMOTION_DECLARATION";
}

/**
 * 一条导出记录在列表里怎么写。
 *
 * **职称表的 year 是申报年度**（2026-09-25 起按任现职时间窗取数），标题写「2027 年申报」，
 * 别写成「2027 年度」——那会被读成 2027 年的成果。绩效表的 year 是成果年度
 */
export function describeExportRun(
  run: ExportRunSummary,
  projectTitles: ReadonlyMap<string, string>,
): ExportRunView {
  const kindLabel = EXPORT_KIND_LABELS[run.kind];
  const declaration = isDeclarationRun(run.kind);
  const options = declaration ? parseDeclarationRunOptions(run.options) : null;

  const title = declaration
    ? run.year == null
      ? kindLabel
      : run.kind === "PROMOTION_DECLARATION"
        ? `${run.year} 年申报 · ${kindLabel}`
        : `${run.year} 年度 · ${kindLabel}`
    : `${kindLabel} · ${
        run.projectId == null ? "课题" : (projectTitles.get(run.projectId) ?? "已删除的课题")
      }`;

  return {
    id: run.id,
    title,
    formatLabel: options ? (options.format === "zip" ? "申报包 ZIP" : "申报表") : null,
    overrides: options
      ? [
          ...(options.includeUnverified ? ["含未核实"] : []),
          ...(options.includeMissingYear ? ["含没填年度"] : []),
        ]
      : [],
    issues: issueLines(run.issueSummary),
    includedCount: run.includedCount,
    href: declaration
      ? `/export/runs/${run.id}`
      : run.projectId != null && projectTitles.has(run.projectId)
        ? `/projects/${run.projectId}`
        : null,
    createdAt: run.createdAt,
  };
}

export type SnapshotRow = {
  index: number;
  title: string;
  year: number | null;
  level: string;
  ownerRole: string;
  score: number | null;
  attachmentCount: number;
  group: { key: string; label: string; parent: string };
  /** 申报包 ZIP 时附上的文件（包内名字）；只导了表的是 null */
  materials: string[] | null;
};

/**
 * 申报表的行快照（`buildExportRunData` 写的那份）。认不出的行跳过，
 * 按序号排好——写入时就是表格顺序，排一次只是防旧数据
 */
export function parseDeclarationSnapshot(snapshot: unknown): SnapshotRow[] {
  if (!Array.isArray(snapshot)) return [];
  const rows = snapshot.flatMap((item): SnapshotRow[] => {
    if (!isRecord(item) || typeof item.index !== "number" || typeof item.title !== "string") {
      return [];
    }
    const group = isRecord(item.group) ? item.group : {};
    return [
      {
        index: item.index,
        title: item.title,
        year: typeof item.year === "number" ? item.year : null,
        level: typeof item.level === "string" ? item.level : "",
        ownerRole: typeof item.ownerRole === "string" ? item.ownerRole : "",
        score: typeof item.score === "number" ? item.score : null,
        attachmentCount: typeof item.attachmentCount === "number" ? item.attachmentCount : 0,
        group: {
          key: typeof group.key === "string" ? group.key : "",
          label: typeof group.label === "string" ? group.label : "",
          parent: typeof group.parent === "string" ? group.parent : "",
        },
        materials: Array.isArray(item.materials)
          ? item.materials.flatMap((material) =>
              isRecord(material) && typeof material.name === "string" ? [material.name] : [],
            )
          : null,
      },
    ];
  });
  return rows.sort((a, b) => a.index - b.index);
}
