import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  describeExportRun,
  isDeclarationRun,
  parseDeclarationRunOptions,
  parseDeclarationSnapshot,
  type ExportRunView,
  type SnapshotRow,
} from "@/lib/export/history";

/** 导出页「最近导出」列几条。再往前的不列，页面上照实说只显示最近这些 */
export const RECENT_EXPORT_LIMIT = 20;

const summarySelect = {
  id: true,
  kind: true,
  year: true,
  projectId: true,
  options: true,
  includedCount: true,
  issueSummary: true,
  createdAt: true,
} as const;

/** `ExportRun.projectId` 不是外键（课题删了记录还在），标题另查一次；用简称，列表里放得下 */
async function projectTitlesOf(projectIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(projectIds.filter((id): id is string => id != null))];
  if (ids.length === 0) return new Map();
  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, shortTitle: true },
  });
  return new Map(projects.map((project) => [project.id, project.shortTitle ?? project.title]));
}

/**
 * 最近的导出记录。**不取快照**——一份申报表的快照几十行，列表只要标题和条数，
 * 行快照点进去再按 id 取
 */
export async function getRecentExportRuns(): Promise<{
  runs: ExportRunView[];
  total: number;
}> {
  const [rows, total] = await Promise.all([
    prisma.exportRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_EXPORT_LIMIT,
      select: summarySelect,
    }),
    prisma.exportRun.count(),
  ]);
  const titles = await projectTitlesOf(rows.map((row) => row.projectId));
  return { runs: rows.map((row) => describeExportRun(row, titles)), total };
}

export type ExportRunDetail = ExportRunView & {
  format: "xlsx" | "zip";
  rows: SnapshotRow[];
  /**
   * 快照是不是逐行的那种形状。不是的话（演示种子里的占位、将来别的写法）页面要照实说
   * 「没存逐行快照」，**不能**说成「空表」——旁边写着 14 条，下面说一条都没进，自相矛盾
   */
  snapshotAvailable: boolean;
};

/**
 * 一次申报表导出当时交出去的行。只认申报表那两种——课题材料 ZIP 和结题清单
 * 的快照是另一种形状，它们的入口在课题详情里，不在这里
 */
async function getExportRunDetailUncached(id: string): Promise<ExportRunDetail | null> {
  const run = await prisma.exportRun.findUnique({
    where: { id },
    select: { ...summarySelect, snapshot: true },
  });
  if (!run || !isDeclarationRun(run.kind)) return null;
  return {
    ...describeExportRun(run, new Map()),
    format: parseDeclarationRunOptions(run.options).format,
    rows: parseDeclarationSnapshot(run.snapshot),
    snapshotAvailable: Array.isArray(run.snapshot),
  };
}

// generateMetadata 和页面各调一次，同一请求只查一次
export const getExportRunDetail = cache(getExportRunDetailUncached);
