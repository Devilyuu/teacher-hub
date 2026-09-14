import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  ACHIEVEMENT_TYPE_LABELS,
  LEVEL_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import {
  type LedgerScope,
  type OutcomeFilters,
  sumNumericScore,
} from "@/lib/outcomes/filters";
import type { UnifiedOutcomeRow } from "@/lib/outcomes/types";
import {
  displayOutcomeYears,
  outcomeRowViewModel,
  outcomeTimeText,
} from "@/lib/outcomes/view-model";

/**
 * 成果台账在手机上的一行（< 768px，2026-09-13）。
 *
 * 桌面那张表 6 列、实测 897px 宽，塞进 390px 的手机要横滑 2.7 屏才看得全，
 * 而横滑时题目那一列早就滑出去了——看到一个分数却不知道是哪条的。
 * 手机上改成两三行的摘要：题目 + 分数一眼对上，其余压成一行小字。
 *
 * **点进去走现有详情页，不另做抽屉。** 详情页本来就在手机上可用、功能齐全；
 * 再做一个抽屉就是第二套详情界面，两边字段早晚对不上。
 *
 * **所有数都从 `outcomeRowViewModel` / `outcomeTimeText` 取**，和 outcome-row.tsx
 * 同一套算法——手机和桌面看同一条记录，年度和分数必须一样。
 * 行内的快速订正（QuickEditRow）不带过来：那是一排原生下拉，手机上点不准，
 * 要改就进详情页。
 */
export function OutcomeSummaryItem({
  row,
  scope,
  currentOutcomePath,
  filters,
}: {
  row: UnifiedOutcomeRow;
  scope: LedgerScope;
  currentOutcomePath: string;
  filters: Pick<OutcomeFilters, "year" | "major" | "minor" | "unverifiedOnly">;
}) {
  const view = outcomeRowViewModel(row, { scope, currentOutcomePath, filters });
  const promotion = scope === "promotion";
  const { yearText } = outcomeTimeText(row, view.performanceEntries, promotion);

  const score = promotion
    ? row.promotionScore
    : view.performanceEntries.some((entry) => entry.declaredScore != null)
      ? sumNumericScore(view.performanceEntries.map((entry) => entry.declaredScore))
      : null;

  const year =
    row.kind === "PROJECT"
      ? promotion
        ? row.promotionYear
        : displayOutcomeYears(view.performanceEntries.map((entry) => entry.year))
      : promotion
        ? row.promotionYear
        : yearText;

  const meta = [
    year ? String(year) : null,
    row.kind === "PROJECT" ? "课题" : ACHIEVEMENT_TYPE_LABELS[row.achievementType],
    LEVEL_LABELS[row.level],
    row.kind === "PROJECT" ? PROJECT_STATUS_LABELS[row.projectStatus] : null,
  ].filter(Boolean);

  const category = promotion
    ? row.promotionCategory
      ? `${row.promotionCategory.code} ${row.promotionCategory.minorIndicator}`
      : null
    : view.performanceSummary || null;

  const flags: string[] = [];
  if (row.kind === "ACHIEVEMENT") {
    if (row.needsLink) flags.push("该挂未挂");
    if (!row.isVerified) flags.push("待确认");
    if (row.promotionScore != null && row.promotionCategory == null) flags.push("填了分未挂指标");
  }
  if (view.schoolRewarded) flags.push("学校已奖励");

  return (
    <li>
      <Link
        href={view.href}
        className="flex items-start gap-3 px-4 py-3 transition-colors active:bg-muted/60"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-sm leading-snug font-medium">{row.title}</p>
            <span className="shrink-0 text-sm tabular-nums">
              {score == null ? <span className="text-muted-foreground">—</span> : String(score)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
          {category ? (
            <p className="line-clamp-1 text-xs text-muted-foreground" title={category}>
              {category}
            </p>
          ) : null}
          {flags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {flags.map((flag) => (
                <span
                  key={flag}
                  className={
                    flag === "该挂未挂" || flag === "填了分未挂指标"
                      ? "rounded bg-[var(--h-amber-bg)] px-1.5 py-0.5 text-xs text-[var(--h-amber-fg)]"
                      : "rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {flag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </Link>
    </li>
  );
}
