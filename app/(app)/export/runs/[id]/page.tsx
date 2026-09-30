import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AchievementTabs } from "@/components/achievement-tabs";
import { FolderArt } from "@/components/empty-art";
import { formatTimestamp } from "@/lib/format";
import type { SnapshotRow } from "@/lib/export/history";
import { getExportRunDetail } from "@/lib/queries/export-runs";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const run = await getExportRunDetail((await params).id);
  return { title: run ? run.title : "导出记录" };
}

/** 快照是表格顺序，同一分组的行挨着；按组切开，组头写一级 / 二级和当时的小计 */
function groupRows(rows: SnapshotRow[]) {
  const groups: Array<{ key: string; parent: string; label: string; rows: SnapshotRow[] }> = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.key === row.group.key) last.rows.push(row);
    else groups.push({ key: row.group.key, parent: row.group.parent, label: row.group.label, rows: [row] });
  }
  return groups;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 一次申报表导出**当时**交出去的行（ExportRun 快照）。
 *
 * 之后改过的分值、分类、标题都不会反映在这里——这页存在的理由就是
 * 回答「上次实际报上去的是什么」，拿现在的数据重算一遍就答非所问了
 */
export default async function ExportRunPage({ params }: { params: Promise<{ id: string }> }) {
  const run = await getExportRunDetail((await params).id);
  if (!run) notFound();

  const groups = groupRows(run.rows);
  const meta = [
    `${formatTimestamp(run.createdAt)} 导出`,
    run.formatLabel,
    `${run.includedCount} 条`,
    run.overrides.length > 0 ? `带问题导出：${run.overrides.join("、")}` : null,
    run.issues.length > 0 ? `当时仍带：${run.issues.join("、")}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <AchievementTabs />

      <header className="space-y-2 pt-2">
        <Link
          href="/export"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          导出
        </Link>
        <h1 className="page-title">{run.title}</h1>
        <p className="text-sm text-muted-foreground">{meta.join(" · ")}</p>
        {/* 中文分行写会在 JSX 里折出一个空格，这句不换行 */}
        <p className="measure text-xs leading-relaxed text-muted-foreground">
          这是当时交出去的那份表，逐行照原样列出。之后改过的分值、分类、标题都不会反映在这里——要看现在的数，回导出页重新导一份。
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
          <FolderArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            {run.snapshotAvailable
              ? "这次导出是一张空表，一条都没进。"
              : "这条记录没有存逐行快照，看不到当时报了哪些行。"}
          </p>
        </div>
      ) : (
        <div className="surface divide-y divide-border/60">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-well px-5 py-2 text-xs text-muted-foreground">
                <span>
                  {group.parent ? `${group.parent} · ` : null}
                  <span className="font-medium text-foreground">{group.label}</span>
                </span>
                <span className="tabular-nums">
                  {group.rows.length} 条 · 小计{" "}
                  {round2(group.rows.reduce((sum, row) => sum + (row.score ?? 0), 0))}
                </span>
              </div>
              <ul className="divide-y divide-border/60">
                {group.rows.map((row) => (
                  <li key={row.index} className="flex gap-3 px-5 py-3">
                    <span className="w-8 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {String(row.index).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm leading-snug">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {[row.year ?? "年度待补", row.level, row.ownerRole].filter(Boolean).join(" · ")}
                      </p>
                      {row.materials ? (
                        row.materials.length > 0 ? (
                          <ul className="space-y-0.5 text-xs text-muted-foreground">
                            {row.materials.map((name) => (
                              <li key={name} className="break-all">
                                {name}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">没附材料</p>
                        )
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {row.attachmentCount > 0 ? `材料 ${row.attachmentCount} 份` : "缺材料"}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {row.score ?? <span className="text-xs font-normal text-muted-foreground">待填</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
