import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { CompletionRing, HealthBadge } from "@/components/health";
import { RequirementCard } from "@/components/requirement-card";
import { projectDisplayName } from "@/lib/achievement-draft";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompletionRate, formatDate, formatDaysLeft, formatGap } from "@/lib/format";
import {
  formatRoleWithRank,
  FUNDING_TYPE_LABELS,
  LEVEL_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/labels";
import { getProjectDetail, getProjectSources } from "@/lib/queries/projects";
import { getProjectPerformanceRules } from "@/lib/queries/perf-categories";
import { getTasksForProject } from "@/lib/queries/routines";
import { dueHint, isDone, sortTasks } from "@/lib/tasks";
import { TASK_SOURCE_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { getPromotionOptions } from "@/lib/queries/promotion-categories";
import { suggestProjectPerformanceEvent } from "@/lib/project-performance";
import { projectIndicatorOptions } from "@/lib/promotion";
import { safeOutcomeReturnPath } from "@/lib/outcomes/links";
import { getAllLinkCandidates } from "@/lib/queries/achievements";
import { toggleArchive, updateProject } from "@/app/(app)/projects/actions";
import { canPreviewInline } from "@/lib/storage";
import { requirementSummariesByAttachment } from "@/lib/materials";
import { AddRequirement } from "./requirement-editor";
import { AttachmentPanel } from "@/components/attachment-panel";
import { ProjectPerformancePanel } from "./project-performance-panel";
import { ArchiveButton, EditProjectPanel } from "./project-actions";
import { SchoolRewardPanel } from "@/components/school-reward-panel";

export const dynamic = "force-dynamic";

const TAB_PANEL = "pt-4 [&[inert]]:hidden";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const project = await getProjectDetail((await params).id);
  return { title: project ? (project.shortTitle ?? project.title) : "课题" };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const project = await getProjectDetail((await params).id);
  if (!project) notFound();
  const returnValue = (await searchParams).returnTo;
  const backHref = safeOutcomeReturnPath(
    typeof returnValue === "string" ? returnValue : null,
  );
  const backLabel =
    backHref === "/projects" ? "返回课题列表" : "返回成果列表";

  const sources = await getProjectSources();
  const projectPromotionOptions = projectIndicatorOptions(await getPromotionOptions());
  const performanceRules = await getProjectPerformanceRules();
  const tasks = await getTasksForProject(project.id);
  const { gap } = project;

  return (
    <div className="space-y-6">
      {/* 圆形返回键 + 超大标题并排，是参考稿最好认的版式 */}
      <header className="flex flex-wrap items-start justify-between gap-6 pt-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Link
            href={backHref}
            aria-label={backLabel}
            className="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
            style={{ boxShadow: "var(--shadow-pill)" }}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>

          <div className="min-w-0 space-y-3">
            <h1 className="page-title max-w-2xl">{project.shortTitle ?? project.title}</h1>
            {project.shortTitle ? (
              <p className="max-w-2xl text-sm text-muted-foreground">{project.title}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {project.code ? <Chip>{project.code}</Chip> : null}
              <Chip>{FUNDING_TYPE_LABELS[project.fundingType]}</Chip>
              <Chip>{LEVEL_LABELS[project.level]}</Chip>
              <Chip>{PROJECT_CATEGORY_LABELS[project.category]}</Chip>
              <Chip>{PROJECT_STATUS_LABELS[project.status]}</Chip>
              <HealthBadge health={gap.health} />
            </div>
          </div>
        </div>

        <div className="surface flex items-center gap-3 px-4 py-3">
          <CompletionRing rate={gap.completionRate} health={gap.health} size={52} />
          <div className="text-sm">
            <div className="font-medium">{formatGap(gap.totalGap, gap.totalRequired)}</div>
            <div className="text-muted-foreground tabular-nums">
              {formatDaysLeft(gap.displayDaysLeft)}
            </div>
          </div>
        </div>
      </header>

      {project.archivedAt ? (
        <p className="rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground">
          这个课题已归档，不出现在看板上。
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <EditProjectPanel
          action={updateProject.bind(null, project.id)}
          sources={sources}
          dataVersion={project.updatedAt.toISOString()}
          projectPromotionOptions={projectPromotionOptions}
          defaults={{
            title: project.title,
            shortTitle: project.shortTitle,
            code: project.code,
            level: project.level,
            category: project.category,
            fundingType: project.fundingType,
            sourceId: project.sourceId,
            hostUnit: project.hostUnit,
            ownerOrder: project.ownerOrder,
            memberCount: project.memberCount,
            role: project.role,
            status: project.status,
            applyDeadline: project.applyDeadline,
            startDate: project.startDate,
            endDate: project.endDate,
            closingDeadline: project.closingDeadline,
            promotionCategoryId: project.promotionCategoryId,
            // Decimal 过不了 Server Component 边界
            promotionScore:
              project.promotionScore == null ? null : Number(project.promotionScore),
            researchContent: project.researchContent,
            note: project.note,
          }}
        />
        <ArchiveButton
          action={toggleArchive.bind(null, project.id)}
          archived={project.archivedAt != null}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="requirements">
            结题清单
            {gap.totalRequired > 0 ? (
              <span className="ml-1 tabular-nums text-muted-foreground">
                {gap.totalQualified}/{gap.totalRequired}
              </span>
            ) : null}
          </TabsTrigger>
          {/* 规格 6.4：课题详情里这一格叫「材料」不叫「附件」——
              台账那边仍是附件，同一张表两个语境两个叫法（CLAUDE.md 术语对照） */}
          <TabsTrigger value="attachments">
            材料
            {project.attachments.length > 0 ? (
              <span className="ml-1 tabular-nums text-muted-foreground">
                {project.attachments.length}
              </span>
            ) : null}
          </TabsTrigger>
          {/* 这个 Tab 是 Task.relatedProject 从自由文本换成外键换来的
              （prd-routines 2：合并本身最大的收益之一） */}
          <TabsTrigger value="tasks">
            任务
            {tasks.length > 0 ? (
              <span className="ml-1 tabular-nums text-muted-foreground">{tasks.length}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* `[&[inert]]:hidden` 不能省：Base UI 切换 Tab 时把上一个面板留在 DOM 里
            并加 inert 属性，而 inert 只禁用交互、不隐藏元素，shadcn 的 TabsContent
            又没带对应样式——不加这条，两个 Tab 的内容会一起显示在页面上。 */}
        <TabsContent value="overview" className={TAB_PANEL} keepMounted={false}>
          <Overview project={project} performanceRules={performanceRules} />
        </TabsContent>

        <TabsContent value="requirements" className={TAB_PANEL} keepMounted={false}>
          <Requirements project={project} />
        </TabsContent>

        <TabsContent value="attachments" className={TAB_PANEL} keepMounted={false}>
          <AttachmentPanel
            owner={{ kind: "project", id: project.id }}
            attachments={project.attachments.map((attachment) => ({
              id: attachment.id,
              kind: attachment.kind,
              code: attachment.code,
              filename: attachment.filename,
              size: attachment.size,
              mimeType: attachment.mimeType,
              note: attachment.note,
              uploadedAt: attachment.uploadedAt,
              // 能否内联预览由服务端判定，客户端组件不重复一份类型白名单
              previewable: canPreviewInline(attachment.mimeType),
            }))}
            // 每份材料说明了哪几条要求，只读显示。**关联入口统一在「结题清单」**，
            // 两边都能改的话，同一件事有两个地方做，改完还得记住去另一边看一眼
            requirementsByAttachment={requirementSummariesByAttachment(project.requirements)}
          />
        </TabsContent>

        <TabsContent value="tasks" className={TAB_PANEL} keepMounted={false}>
          <ProjectTasks tasks={tasks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2.5 py-1">{children}</span>;
}

type Detail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

function Overview({
  project,
  performanceRules,
}: {
  project: Detail;
  performanceRules: Awaited<ReturnType<typeof getProjectPerformanceRules>>;
}) {
  const { gap } = project;

  // Decimal 过不了 Server Component 边界，转成字符串再交给客户端组件
  const performanceSource = {
    title: project.title,
    shortTitle: project.shortTitle,
    level: project.level,
    role: project.role,
    fundingType: project.fundingType,
    status: project.status,
    fundingReceived: project.fundingReceived?.toString() ?? null,
    applyDeadline: project.applyDeadline,
    startDate: project.startDate,
    endDate: project.endDate,
    closingDeadline: project.closingDeadline,
    dateText: project.dateText,
  };

  return (
    <div className="space-y-6">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="纵向 / 横向" value={FUNDING_TYPE_LABELS[project.fundingType]} />
        <Field label="立项来源" value={project.source?.name} />
        <Field label="承担单位" value={project.hostUnit} />
        <Field
          label="本人角色"
          value={formatRoleWithRank(project.role, project.ownerOrder, project.memberCount)}
          hint={project.ownerOrder == null ? "未填排名" : undefined}
        />
        <Field label="立项日" value={formatDate(project.startDate)} />
        <Field label="研究期终止日" value={formatDate(project.endDate)} />
        <Field label="结题材料截止日" value={formatDate(project.closingDeadline)} />
        <Field
          label="完成度"
          value={formatCompletionRate(gap.completionRate)}
          hint={gap.completionRate == null ? "尚未录入结题要求，无法计算" : undefined}
        />
        <Field
          label="经费"
          value={
            project.fundingTotal
              ? `${project.fundingTotal} 元${project.fundingReceived ? `（已到账 ${project.fundingReceived} 元）` : ""}`
              : null
          }
        />
      </dl>

      {/* 职称量化。一个课题只占一行——5.2 是「每项加 N 分」，
          按项赋分，不是立项算一次、结题再算一次 */}
      {project.promotionCategory ? (
        <section className="space-y-1">
          <h2 className="text-sm font-medium">
            职称量化 · {project.promotionCategory.year} 年度
          </h2>
          <p className="text-sm">
            {project.promotionCategory.code} {project.promotionCategory.minorIndicator}
            {project.promotionScore == null ? null : (
              <span className="ml-2 tabular-nums">{String(project.promotionScore)} 分</span>
            )}
            {project.promotionCategory.cap == null ? null : (
              <span className="ml-2 text-xs text-muted-foreground">
                本栏上限 {String(project.promotionCategory.cap)} 分
              </span>
            )}
          </p>
          {/* 赋分细则原样显示，分数由人对着它自己填（设计原则第 1 条） */}
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {project.promotionCategory.scoringRule}
          </p>
        </section>
      ) : null}

      <ProjectPerformancePanel
        projectId={project.id}
        project={performanceSource}
        rules={performanceRules}
        suggestedKind={suggestProjectPerformanceEvent(performanceSource)}
        fallbackYear={new Date().getFullYear()}
        events={project.performanceEvents.map((event) => ({
          id: event.id,
          kind: event.kind,
          year: event.year,
          perfCategory: event.perfCategory
            ? {
                year: event.perfCategory.year,
                majorCategory: event.perfCategory.majorCategory,
                minorCategory: event.perfCategory.minorCategory,
              }
            : null,
          declaredScore: event.declaredScore?.toString() ?? null,
          isVerified: event.isVerified,
          legacyAchievementId: event.legacyAchievementId,
        }))}
      />

      <SchoolRewardPanel
        target={{ kind: "PROJECT", id: project.id }}
        decisions={project.schoolRewards.map((decision) => ({
          id: decision.id,
          approvedAt: decision.approvedAt,
          batch: decision.batch,
          domain: decision.domain,
          awardItem: decision.awardItem,
          awardLevel: decision.awardLevel,
          awardAmountYuan: decision.awardAmountYuan?.toString() ?? null,
          evidenceRef: decision.evidenceRef,
          note: decision.note,
        }))}
      />

      {/* 原始时间表述。精度不到日的日期以它为准，不许拿推算值当真（CLAUDE.md 第 8 条） */}
      {project.dateText ? (
        <section className="space-y-1">
          <h2 className="text-sm font-medium">时间原文</h2>
          <p className="text-sm text-muted-foreground">{project.dateText}</p>
        </section>
      ) : null}

      {project.members.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">成员</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {project.members.map((member) => (
              <li key={member.id} className="rounded border px-2 py-1">
                {member.name}
                {member.role ? (
                  <span className="ml-1 text-xs text-muted-foreground">{member.role}</span>
                ) : null}
                {member.isExternal ? (
                  <span className="ml-1 text-xs text-muted-foreground">企业方</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {project.note ? (
        <section className="space-y-1">
          <h2 className="text-sm font-medium">备注</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {project.note}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value?.trim() ? value : "—"}</dd>
      {hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

async function Requirements({ project }: { project: Detail }) {
  const { gap } = project;
  const candidates = await getAllLinkCandidates();

  return (
    <div className="space-y-4">
      {/* 结题清单 Word（规格 7.4）。要求项为空时也放出来——那份清单同样有用：
          课题基本情况和材料目录照样能交，缺什么它会如实写着 */}
      <form
        action="/api/export/project-closeout"
        method="post"
        className="surface flex flex-wrap items-center gap-3 p-3.5"
      >
        <input type="hidden" name="projectId" value={project.id} />
        <Button type="submit" size="sm" variant="secondary">
          <FileDown className="size-3.5" aria-hidden />
          生成结题清单 Word
        </Button>
        <p className="text-xs text-muted-foreground">
          含课题基本情况、逐条要求与已确认达标的成果、材料总目录；材料编号与「下载全部材料」的 ZIP 一致
        </p>
      </form>

      {project.requirements.length === 0 ? (
        <div className="surface p-10 text-center">
          <p className="text-sm">尚未录入结题要求。</p>
          <p className="mt-2 text-sm text-muted-foreground">
            没有要求项就算不出缺口，完成度显示「—」而不是 0%——系统不会替你假设这个课题没有要求。
          </p>
        </div>
      ) : (
        // gap.requirements 与 project.requirements 同序（查询与计算都按 sortOrder）
        project.requirements.map((requirement, index) => (
          <RequirementCard
            key={requirement.id}
            projectId={project.id}
            projectName={projectDisplayName(project)}
            fundingType={project.fundingType}
            requirement={requirement}
            gap={gap.requirements[index]}
            reusedAchievementIds={gap.reusedAchievementIds}
            crossProjectUses={project.crossProjectUses}
            candidates={candidates.filter(
              (candidate) => !requirement.links.some((l) => l.achievementId === candidate.id),
            )}
            // 候选只列本课题的材料，且排掉已经关联到这条要求项的——
            // 跨课题和成果级证据在服务端也会被拒（lib/materials.ts），
            // 但下拉里就不该出现它们
            materialCandidates={project.attachments
              .filter((a) => !requirement.materials.some((m) => m.attachmentId === a.id))
              .map((a) => ({
                id: a.id,
                kind: a.kind,
                filename: a.filename,
                code: a.code,
              }))}
          />
        ))
      )}

      <AddRequirement projectId={project.id} fundingType={project.fundingType} />
    </div>
  );
}

/**
 * 课题下的任务。**只读**——改任务去 /tasks，那里才有完整的表单和筛选。
 * 这个 Tab 回答的是「这个课题手上还压着什么事」，不是任务管理界面。
 */
function ProjectTasks({ tasks }: { tasks: Awaited<ReturnType<typeof getTasksForProject>> }) {
  if (tasks.length === 0) {
    return (
      // 空状态一律 well 面板 + 单色插画（CLAUDE.md），白卡留给正式内容
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
        <ClipboardArt className="size-12 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          这个课题下还没有任务。到{" "}
          <Link href="/tasks" className="underline underline-offset-4">
            任务
          </Link>{" "}
          新建时选上本课题，就会出现在这里。
        </p>
      </div>
    );
  }

  const open = sortTasks(tasks.filter((task) => !isDone(task)));
  const done = tasks.filter(isDone);

  return (
    <div className="space-y-5">
      {/* 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片） */}
      <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
        {open.map((task) => {
          const hint = dueHint(task);
          return (
            <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 text-sm">{task.title}</span>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span className="rounded border px-1.5 py-0.5">
                  {TASK_SOURCE_LABELS[task.source]}
                </span>
                {task.status === "DOING" ? <span>{TASK_STATUS_LABELS.DOING}</span> : null}
                {hint ? (
                  <span
                    className={
                      hint.tone === "overdue" ? "text-[var(--h-amber-fg)]" : undefined
                    }
                  >
                    {hint.text}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {done.length > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          另有 <span className="tabular-nums">{done.length}</span> 条已完成
        </p>
      ) : null}
    </div>
  );
}
