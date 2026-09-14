import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { CompassArt } from "@/components/empty-art";
import { HealthBadge } from "@/components/health";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompletionRate, formatDaysLeft, formatGap } from "@/lib/format";
import {
  formatRoleWithRank,
  FUNDING_TYPE_SECTION_LABELS,
  isHealthLabelRedundant,
  LEVEL_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import {
  getProjectSummaries,
  isArchivedProject,
  type ProjectSummary,
} from "@/lib/queries/projects";
import type { FundingType } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "课题" };

export default async function ProjectsPage() {
  // 台账是全量的，归档的也要在，只是标出来——
  // 「不显示归档」是罗盘的事，这里要能查到历年所有课题
  const projects = await getProjectSummaries({ includeArchived: true });

  const vertical = projects.filter((p) => p.fundingType === "VERTICAL");
  const horizontal = projects.filter((p) => p.fundingType === "HORIZONTAL");

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">课题</h1>
          <p className="measure text-muted-foreground">
            课题台账与结题清单，逐项挂接成果、计算缺口。
          </p>
        </div>
        <Button render={<Link href="/projects/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden />
          新建课题
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-14 text-center">
          <CompassArt className="size-12 text-muted-foreground/60" />
          <p className="text-muted-foreground">还没有课题。</p>
        </div>
      ) : (
        <>
          <ProjectSection fundingType="VERTICAL" projects={vertical} />
          <ProjectSection fundingType="HORIZONTAL" projects={horizontal} />
        </>
      )}
    </div>
  );
}

function ProjectSection({
  fundingType,
  projects,
}: {
  fundingType: FundingType;
  projects: ProjectSummary[];
}) {
  // 横向项目谈的是到账，纵向谈的是级别，两段的列刻意不一样
  const isHorizontal = fundingType === "HORIZONTAL";

  // 归档的收到本段底部折叠起来，理由同首页 ArchivedShelf：
  // 25 个课题里归档的占多数，混排会把在研的埋掉。
  // **按段各折一次而不是整页折一次**——两段的列本来就不同，
  // 合成一个归档区就得把纵向/横向的分段逻辑再抄一遍
  const active = projects.filter((p) => !isArchivedProject(p));
  // **未获立项的单独一栏，不混进历史课题。** 两者都不该占在研的视线，
  // 但它们不是一回事：历史课题是做过的，未获立项的是没做成的。
  // 混在一起翻历史时得逐条看状态才知道哪些真的做过
  const rejected = projects.filter((p) => p.status === "REJECTED");
  const archived = projects.filter(
    (p) => isArchivedProject(p) && p.status !== "REJECTED",
  );

  // 到账额算全量：历年累计本来就该含已结题的那些
  const totalReceived = isHorizontal
    ? projects.reduce((sum, p) => sum + Number(p.fundingReceived ?? 0), 0)
    : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="text-sm font-medium">
          {FUNDING_TYPE_SECTION_LABELS[fundingType]}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {active.length}
        </span>
        {isHorizontal && totalReceived > 0 ? (
          <span className="text-xs text-muted-foreground">
            累计到账 {(totalReceived / 10000).toFixed(1)} 万
          </span>
        ) : null}
      </div>

      {/* 全段都折起来时不显示空态——下面的折叠条已经说清楚人都去哪了 */}
      {active.length === 0 && archived.length === 0 && rejected.length === 0 ? (
        <p className="rounded-3xl bg-well p-8 text-center text-xs text-muted-foreground">
          暂无{FUNDING_TYPE_SECTION_LABELS[fundingType]}
        </p>
      ) : null}

      {active.length > 0 ? (
        <ProjectTable projects={active} isHorizontal={isHorizontal} />
      ) : null}

      <CollapsedShelf
        title={`已归档的历史${FUNDING_TYPE_SECTION_LABELS[fundingType]}`}
        projects={archived}
        isHorizontal={isHorizontal}
      />

      {/* 未获立项单独一栏。绩效上它们只有基本分 3 分，
          和做过的历史课题不是一回事，别混着看 */}
      <CollapsedShelf
        title="未获立项"
        hint="申报了没中，绩效只算基本分"
        projects={rejected}
        isHorizontal={isHorizontal}
      />
    </section>
  );
}

/** 折叠起来的一栏课题。已归档、未获立项各用一个，样式与首页 ArchivedShelf 一致 */
function CollapsedShelf({
  title,
  hint,
  projects,
  isHorizontal,
}: {
  title: string;
  hint?: string;
  projects: ProjectSummary[];
  isHorizontal: boolean;
}) {
  if (projects.length === 0) return null;

  return (
    <details className="group">
      {/* 折叠条走中间调：归档是「虚」的，白底胶囊会和在研表抢视线 */}
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-well px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {projects.length}
        </span>
        {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
        <span className="text-xs group-open:hidden">展开</span>
        <span className="hidden text-xs group-open:inline">收起</span>
      </summary>

      <div className="mt-3">
        <ProjectTable projects={projects} isHorizontal={isHorizontal} />
      </div>
    </details>
  );
}

/** 在研表和归档表用的是同一套列，只是数据不同 */
function ProjectTable({
  projects,
  isHorizontal,
}: {
  projects: ProjectSummary[];
  isHorizontal: boolean;
}) {
  return (
    // 横滚容器只在 lg 以下才要：滚动容器会把 thead 的 sticky 锚到自己身上，
    // 表头就永远粘不住。列都限了宽，lg 以上装得进内容区（处方同成果表，
    // 见 achievements/page.tsx 那段注释）
    <>
      {/* 手机上换成摘要列表（< 768px）。9 列的表塞进 390px 要横滑三屏，
          滑到「倒计时」时课题名早就出去了。和成果页同一处方：两份都渲染、CSS 切，
          点进去走现有详情页。**健康度徽章留在题目旁边**——这张表存在的理由
          就是一眼看出哪个课题要出事，手机上不能把它挤到第三行去 */}
      <ul className="surface divide-y divide-border/60 overflow-hidden md:hidden">
        {projects.map((project) => {
          const facts = [
            isHorizontal
              ? project.fundingReceived
                ? `到账 ${(Number(project.fundingReceived) / 10000).toFixed(1)} 万`
                : null
              : LEVEL_LABELS[project.level],
            formatRoleWithRank(project.role, project.ownerOrder, project.memberCount),
            isHealthLabelRedundant(project.status, project.gap.health)
              ? null
              : PROJECT_STATUS_LABELS[project.status],
          ].filter(Boolean);
          return (
            <li key={project.id} className={project.archivedAt ? "opacity-60" : undefined}>
              <Link
                href={`/projects/${project.id}`}
                className="flex items-start gap-3 px-4 py-3 transition-colors active:bg-muted/60"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm leading-snug font-medium">
                      {project.shortTitle ?? project.title}
                    </p>
                    <HealthBadge health={project.gap.health} className="shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs tabular-nums">
                    <span>{formatGap(project.gap.totalGap, project.gap.totalRequired)}</span>
                    <span className="text-muted-foreground">
                      完成度 {formatCompletionRate(project.gap.completionRate)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDaysLeft(project.gap.displayDaysLeft)}
                    </span>
                  </p>
                </div>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    <div className="surface p-1 max-md:hidden">
      <Table containerClassName="max-lg:overflow-x-auto">
        <TableHeader className="sticky max-lg:top-0 lg:top-[var(--topbar-h)] z-10 bg-popover">
          <TableRow>
            <TableHead className="min-w-[18rem]">课题</TableHead>
            <TableHead>编号</TableHead>
            <TableHead>{isHorizontal ? "委托方" : "立项来源"}</TableHead>
            {isHorizontal ? (
              <TableHead className="text-right">到账</TableHead>
            ) : (
              <TableHead>级别</TableHead>
            )}
            <TableHead>本人角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>缺口</TableHead>
            <TableHead className="text-right">完成度</TableHead>
            <TableHead className="text-right">倒计时</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow
              key={project.id}
              className={project.archivedAt ? "opacity-60" : undefined}
            >
              {/* 主列限宽 22rem：不限的话长标题会把表撑到 1347px，
                  而 1440 屏上内容区只有 1272px，最后的「倒计时」列直接被切掉。
                  限宽 + truncate + title 存全文，是 CLAUDE.md 视觉语言那条
                  「长文本列必须限宽」的同一处方 */}
              <TableCell>
                <div className="flex max-w-[22rem] items-center gap-2">
                  <Link
                    href={`/projects/${project.id}`}
                    className="truncate font-medium underline-offset-4 hover:underline"
                    title={project.title}
                  >
                    {project.shortTitle ?? project.title}
                  </Link>
                  {project.archivedAt ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      已归档
                    </span>
                  ) : null}
                </div>
                {project.shortTitle ? (
                  <p
                    className="mt-0.5 max-w-[22rem] truncate text-xs text-muted-foreground"
                    title={project.title}
                  >
                    {project.title}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {project.code ?? "—"}
              </TableCell>
              {/* 立项来源同样限宽。「某省高等职业教育信息化教学改革专项研究项目」
                  这一条不限宽单它一列就要 296px */}
              <TableCell className="text-muted-foreground">
                <span
                  className="block max-w-[11rem] truncate"
                  title={project.source?.name ?? undefined}
                >
                  {project.source?.name ?? "—"}
                </span>
              </TableCell>
              {isHorizontal ? (
                <TableCell className="text-right tabular-nums">
                  {project.fundingReceived
                    ? `${(Number(project.fundingReceived) / 10000).toFixed(1)} 万`
                    : "—"}
                </TableCell>
              ) : (
                <TableCell>{LEVEL_LABELS[project.level]}</TableCell>
              )}
              {/* 角色与排名合成一列：两者都在回答"我在这个课题里是什么位置" */}
              <TableCell className="whitespace-nowrap">
                {formatRoleWithRank(
                  project.role,
                  project.ownerOrder,
                  project.memberCount,
                )}
              </TableCell>
              {/* 状态与健康度重合时只留徽章，不把「申报中」印两遍
                  （见 lib/labels.ts 的 isHealthLabelRedundant） */}
              <TableCell>
                <div className="flex flex-col gap-1">
                  {isHealthLabelRedundant(
                    project.status,
                    project.gap.health,
                  ) ? null : (
                    <span>{PROJECT_STATUS_LABELS[project.status]}</span>
                  )}
                  <HealthBadge health={project.gap.health} className="w-fit" />
                </div>
              </TableCell>
              <TableCell>
                {formatGap(project.gap.totalGap, project.gap.totalRequired)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCompletionRate(project.gap.completionRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatDaysLeft(project.gap.displayDaysLeft)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </>
  );
}
