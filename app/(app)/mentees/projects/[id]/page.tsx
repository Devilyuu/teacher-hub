import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { MenteeTabs } from "@/components/mentee-tabs";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { Button } from "@/components/ui/button";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { ATTACHMENT_KIND_LABELS } from "@/lib/labels";
import { MENTEE_ADOPT_ATTACHMENT_KINDS, menteeAchievementTitle } from "@/lib/mentees";
import { isModuleEnabled } from "@/lib/module-settings";
import {
  getActiveMentees,
  getMenteeProjectDetail,
  getMenteeProjectKinds,
} from "@/lib/queries/mentees";
import { canPreviewInline } from "@/lib/storage";
import { AdoptPanel } from "./adopt-panel";
import { MilestonesPanel, type MilestoneRow } from "./milestones-panel";
import { ProjectDangerZone } from "./project-danger-zone";
import { ProjectForm } from "./project-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "项目详情" };

export default async function MenteeProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isModuleEnabled("mentor"))) {
    return <ModuleDisabledNotice moduleKey="mentor" />;
  }

  const { id } = await params;
  const project = await getMenteeProjectDetail(id);
  if (!project) notFound();

  const [kinds, mentees] = await Promise.all([
    getMenteeProjectKinds(),
    getActiveMentees(project.batchId),
  ]);

  const today = todayAsDateOnly();
  const milestones: MilestoneRow[] = project.milestones.map((milestone) => ({
    id: milestone.id,
    label: milestone.label,
    dateText: milestone.date ? formatDateOnly(milestone.date) : null,
    note: milestone.note,
    // 只是排版用的淡化，不是状态判定——没有「完成」这回事
    past: milestone.date != null && milestone.date < today,
  }));

  // 编辑表单里的学生候选：在带的 + 已挂上但已毕业的那些，
  // 否则一保存就会把毕业生从项目里悄悄摘掉
  const memberIds = project.members.map((member) => member.menteeId);
  const candidates = [
    ...mentees,
    ...project.members
      .filter((member) => !mentees.some((m) => m.id === member.menteeId))
      .map((member) => ({ id: member.menteeId, name: `${member.mentee.name}（已毕业）` })),
  ];

  const outcomeText = project.outcomeText?.trim() || null;
  const movedKindLabels = MENTEE_ADOPT_ATTACHMENT_KINDS.map(
    (kind) => ATTACHMENT_KIND_LABELS[kind],
  );

  return (
    <div className="space-y-6">
      <MenteeTabs batchId={project.batchId} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">{project.title}</h1>
          <p className="measure text-muted-foreground">
            {[
              project.kind.name,
              project.schoolYear,
              project.members.map((m) => m.mentee.name).join("、") || "未挂学生",
              project.batch.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {project.attachments.length > 0 ? (
            <form action={`/api/export/mentee-project-zip`} method="post">
              <input type="hidden" name="projectId" value={project.id} />
              <Button type="submit" size="sm" variant="secondary">
                <Download className="size-3.5" aria-hidden />
                材料包
              </Button>
            </form>
          ) : null}
          <form action="/api/export/mentee-guidance-sheet" method="post">
            <input type="hidden" name="projectId" value={project.id} />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={project.records.length === 0}
            >
              <Download className="size-3.5" aria-hidden />
              指导记录表
            </Button>
          </form>
        </div>
      </header>

      <AdoptPanel
        projectId={project.id}
        outcomeText={outcomeText}
        previewTitle={
          outcomeText
            ? menteeAchievementTitle({
                title: project.title,
                kindName: project.kind.name,
                outcomeText,
              })
            : null
        }
        movedKindLabels={movedKindLabels}
        achievement={project.achievement}
      />

      {/* 桌面左右两栏：左边表单 + 材料，右边节点 + 指导 + 删除。
          手机上原样竖排的话，一打开是整块编辑表单，最常看的节点要翻很远——
          所以 < lg 让两个栏容器 `contents` 掉，子块直接成为网格项再按 order 排：
          节点 → 指导 → 材料 → 表单 → 删除。间距交给网格 gap，栏内 space-y 只在 lg 起作用 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="max-lg:contents lg:space-y-6">
          <div className="max-lg:order-4">
            <ProjectForm
              projectId={project.id}
              dataVersion={project.updatedAt.toISOString()}
              kinds={kinds.map((kind) => ({ id: kind.id, name: kind.name }))}
              mentees={candidates}
              defaults={{
                title: project.title,
                kindId: project.kind.id,
                schoolYear: project.schoolYear ?? "",
                outcomeText: project.outcomeText ?? "",
                note: project.note ?? "",
                memberIds,
              }}
            />
          </div>

          <section className="space-y-3 max-lg:order-3">
            <h2 className="px-1 text-base font-semibold">材料</h2>
            <p className="measure px-1 text-sm text-muted-foreground">
              任务书、开题报告、中期检查表、作品文件、评审表。
              学校毕设系统里要交的那几份，这儿留一份自己的底。
              <span className="text-foreground">
                引用为成果时，只有{movedKindLabels.join("、")}会跟着成果走
              </span>
              ——其余是指导过程档案，留在这儿。
            </p>
            <AttachmentPanel
              owner={{ kind: "menteeProject", id: project.id }}
              attachments={project.attachments.map((attachment) => ({
                id: attachment.id,
                kind: attachment.kind,
                code: attachment.code,
                filename: attachment.filename,
                size: attachment.size,
                mimeType: attachment.mimeType,
                note: attachment.note,
                uploadedAt: attachment.uploadedAt,
                previewable: canPreviewInline(attachment.mimeType),
              }))}
            />
          </section>
        </div>

        <div className="max-lg:contents lg:space-y-6">
          <div className="max-lg:order-1">
            <MilestonesPanel projectId={project.id} milestones={milestones} />
          </div>

          <section className="space-y-3 max-lg:order-2">
            <h2 className="px-1 text-base font-semibold">
              围绕这个项目的指导
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {project.records.length} 条
              </span>
            </h2>
            {project.records.length === 0 ? (
              <p className="measure rounded-3xl bg-well p-6 text-center text-sm text-muted-foreground">
                还没有。在
                <Link href="/mentees/records" className="mx-1 underline underline-offset-4">
                  指导记录
                </Link>
                里记一条并挂到这个项目上，答辩季那张表就有内容了。
              </p>
            ) : (
              <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
                {project.records.map((record) => (
                  <li key={record.id} className="px-4 py-2.5">
                    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatDateOnly(record.date)}</span>
                      <span className="rounded border px-1.5 py-0.5">{record.type.name}</span>
                      {record.members.length > 0 ? (
                        <span>{record.members.map((m) => m.mentee.name).join("、")}</span>
                      ) : null}
                    </p>
                    <p className="measure mt-1 text-sm whitespace-pre-wrap">{record.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="max-lg:order-5">
            <ProjectDangerZone
              projectId={project.id}
              title={project.title}
              attachmentCount={project.attachments.length}
              recordCount={project.records.length}
              adopted={project.achievementId != null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
