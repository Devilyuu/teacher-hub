import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { formatTimestamp } from "@/lib/format";
import { integrationStatuses } from "@/lib/integrations";
import { MEETING_TYPE_LABELS, TASK_SOURCE_LABELS } from "@/lib/labels";
import { parseAgenda, parseResolutions } from "@/lib/meetings";
import { getMeetingDetail, getPendingAgendaItems } from "@/lib/queries/routines";
import { dueHint, isDone } from "@/lib/tasks";
import { deleteMeeting } from "../actions";
import { MeetingDetail } from "./meeting-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const meeting = await getMeetingDetail((await params).id);
  return { title: meeting?.title ?? "会议" };
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const meeting = await getMeetingDetail((await params).id);
  if (!meeting) notFound();

  const pool = await getPendingAgendaItems();
  const asrConfigured = integrationStatuses().find((status) => status.key === "asr")?.configured ?? false;
  const minutesConfigured = integrationStatuses().find((status) => status.key === "minutes")?.configured ?? false;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-6 pt-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Link
            href="/meetings"
            aria-label="返回会议列表"
            className="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
            style={{ boxShadow: "var(--shadow-pill)" }}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div className="min-w-0 space-y-2">
            <h1 className="page-title max-w-2xl">{meeting.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2.5 py-1">
                {MEETING_TYPE_LABELS[meeting.type]}
              </span>
              <span className="rounded-full bg-muted px-2.5 py-1 tabular-nums">
                {formatTimestamp(meeting.meetingTime)}
              </span>
            </div>
          </div>
        </div>

        {/* 会议是硬删、没有回收站，原来点一下就没了。
            文案要把「保留什么」也说出来：派生的任务和议题不跟着删（deleteMeeting 注释），
            只说「删除」会让人以为连带的待办也没了而不敢删 */}
        <ConfirmSubmitButton
          action={deleteMeeting.bind(null, meeting.id)}
          message={`删除会议「${meeting.title}」？纪要和决议会一起删掉，找不回来。由它派出去的任务和议题会保留。`}
        >
          删除会议
        </ConfirmSubmitButton>
      </header>

      <MeetingDetail
        meetingId={meeting.id}
        agenda={parseAgenda(meeting.agenda)}
        minutes={meeting.minutes}
        resolutions={parseResolutions(meeting.resolutions)}
        pool={pool.map((item) => ({ id: item.id, content: item.content }))}
        transcriptionEnabled={meeting.transcriptionEnabled}
        asrConfigured={asrConfigured}
        minutesConfigured={minutesConfigured}
        recordings={meeting.recordings}
      />

      {/* 这次会派生出去的任务。删会议时它们不跟着删——
          决议转成的任务是独立的待办，会议记录删了不代表那件事不用做了 */}
      {meeting.tasks.length > 0 ? (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">本次会议派生的任务</h2>
          <ul className="space-y-2">
            {meeting.tasks.map((task) => {
              const hint = dueHint(task);
              return (
                <li key={task.id} className="surface flex flex-wrap items-center gap-3 p-3.5">
                  <span
                    className={
                      isDone(task) ? "min-w-0 flex-1 text-sm line-through opacity-60" : "min-w-0 flex-1 text-sm"
                    }
                  >
                    {task.title}
                  </span>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span className="rounded border px-1.5 py-0.5">
                      {TASK_SOURCE_LABELS[task.source]}
                    </span>
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
        </section>
      ) : null}
    </div>
  );
}
