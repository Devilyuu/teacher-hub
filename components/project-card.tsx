import Link from "next/link";
import { CompletionRing, HealthBadge } from "@/components/health";
import { formatDaysLeft, formatGap } from "@/lib/format";
import { LEVEL_LABELS } from "@/lib/labels";
import type { ProjectSummary } from "@/lib/queries/projects";

/**
 * 看板卡片。PRD 4.1 限定只显示 5 个元素：
 * 简称、级别徽标、缺口、倒计时、完成度环。别往上加字段。
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  const { gap } = project;

  return (
    <Link href={`/projects/${project.id}`} className="surface-interactive block p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="truncate font-medium" title={project.title}>
            {project.shortTitle ?? project.title}
          </h3>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
              {LEVEL_LABELS[project.level]}
            </span>
            <HealthBadge health={gap.health} />
          </div>
        </div>

        <CompletionRing rate={gap.completionRate} health={gap.health} />
      </div>

      <dl className="mt-4 flex items-baseline justify-between gap-2 text-sm">
        <div className="min-w-0">
          <dt className="sr-only">缺口</dt>
          <dd className="truncate">{formatGap(gap.totalGap, gap.totalRequired)}</dd>
        </div>
        <div className="shrink-0 text-muted-foreground">
          <dt className="sr-only">倒计时</dt>
          <dd className="tabular-nums">{formatDaysLeft(gap.displayDaysLeft)}</dd>
        </div>
      </dl>
    </Link>
  );
}
