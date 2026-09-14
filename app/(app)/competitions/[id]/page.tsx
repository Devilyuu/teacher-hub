import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { entryTitle } from "@/lib/competitions";
import { prisma } from "@/lib/db";
import { canPreviewInline } from "@/lib/storage";
import { getEnabledModules } from "@/lib/module-settings";
import { getCompetitionEntry, getCompetitions } from "@/lib/queries/competitions";
import { AdoptPanel } from "./adopt-panel";
import { CoachesPanel } from "./coaches-panel";
import { EntryEditor } from "./entry-editor";
import { MembersPanel } from "./members-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "参赛详情" };

/**
 * 一次参赛的详情：基本信息、队员、指导教师、材料、引用为成果。
 *
 * 「引用为成果」是参赛进入台账的**唯一**路径，系统不会自己走（第 1 条铁律）。
 */
export default async function CompetitionEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const modules = await getEnabledModules();
  if (!modules.competitions) {
    return <ModuleDisabledNotice moduleKey="competitions" />;
  }

  const { id } = await params;
  const [entry, competitions] = await Promise.all([
    getCompetitionEntry(id),
    getCompetitions(),
  ]);
  if (!entry) notFound();

  // 教师名录复用轮派那份字典。**不按轮派模块的开关过滤**——
  // 关掉轮派只是不记分派，合作指导教师这件事还在
  const teachers = await prisma.teacher.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // 在册学生只在班主任模块开着时取。关着就只显示姓名文本——
  // 参赛学生常常跨班、甚至已经毕业，关联从来只是锦上添花
  const students = modules.advisor
    ? await prisma.student.findMany({
        where: { active: true },
        orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
        select: { id: true, name: true, classGroup: { select: { name: true } } },
      })
    : [];

  const title = entryTitle({
    year: entry.year,
    competitionName: entry.competition.name,
    track: entry.track,
    level: entry.level,
  });

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <Link
          href="/competitions"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          参赛
        </Link>
        <h1 className="page-title mt-2">{title}</h1>
        {entry.editionText ? (
          <p className="mt-1 text-sm text-muted-foreground">{entry.editionText}</p>
        ) : null}
      </div>

      <AdoptPanel
        entryId={entry.id}
        award={entry.award}
        awardTitle={entry.awardTitle}
        achievement={entry.achievement}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <EntryEditor
            entryId={entry.id}
            dataVersion={entry.updatedAt.toISOString()}
            competitions={competitions.map((competition) => ({
              id: competition.id,
              name: competition.name,
              level: competition.level,
            }))}
            defaults={{
              competitionId: entry.competition.id,
              track: entry.track,
              year: entry.year,
              editionText: entry.editionText,
              level: entry.level,
              status: entry.status,
              registerDeadline: entry.registerDeadline,
              competeAt: entry.competeAt,
              competeDateText: entry.competeDateText,
              award: entry.award,
              awardTitle: entry.awardTitle,
              awardedAt: entry.awardedAt,
              awardDateText: entry.awardDateText,
              myOrder: entry.myOrder,
              note: entry.note,
            }}
            deletable={entry.achievementId == null}
          />

          <section className="space-y-3">
            <h2 className="px-1 text-sm font-medium">材料</h2>
            <p className="measure px-1 text-xs text-muted-foreground">
              赛事通知、报名表、获奖证书。
              <span className="text-foreground">
                引用为成果时，只有「获奖证书」会跟着成果走
              </span>
              ——通知和报名表是备赛档案，留在这儿。
            </p>
            <AttachmentPanel
              owner={{ kind: "competitionEntry", id: entry.id }}
              attachments={entry.attachments.map((attachment) => ({
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

        <div className="space-y-6">
          <MembersPanel
            entryId={entry.id}
            members={entry.members.map((member) => ({
              id: member.id,
              name: member.name,
              note: member.note,
              studentId: member.studentId,
              studentLabel: member.student
                ? `${member.student.classGroup.name} ${member.student.name}`
                : null,
            }))}
            students={students.map((student) => ({
              id: student.id,
              label: `${student.classGroup.name} ${student.name}`,
            }))}
            advisorEnabled={modules.advisor}
          />

          <CoachesPanel
            entryId={entry.id}
            teachers={teachers}
            selected={entry.coaches.map((coach) => coach.teacher.id)}
            myOrder={entry.myOrder}
          />
        </div>
      </div>
    </div>
  );
}
