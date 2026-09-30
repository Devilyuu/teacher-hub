"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { ArrowRight, Trash2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { resolutionSnapshot, type Resolution } from "@/lib/meetings";
import {
  addAgendaEntry,
  addResolution,
  convertResolutionToTask,
  pullAgendaItem,
  removeAgendaEntry,
  removeResolution,
  saveMinutes,
  setMeetingTranscriptionEnabled,
} from "../actions";
import { RecordingPanel, type RecordingPanelItem } from "./recording-panel";

export type PoolItem = { id: string; content: string };

function SubmitButton({ label, small }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={small ? "sm" : "sm"} disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

/**
 * 议题池里「拉进来」的那颗胶囊。和下面「转成任务」一样要有提交中状态：
 * 点了没反应的按钮会被再点一次（2026-09-14 审核报告）。服务端各有兜底
 * （只拉 PENDING 的议题、转任务带快照校验），这里补的是反馈
 */
function PullPoolItemButton({ content }: { content: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait"
      style={{ boxShadow: "var(--shadow-pill)" }}
    >
      {content}
      <ArrowRight className="size-3" aria-hidden />
    </button>
  );
}

function ConvertToTaskButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "转换中…" : "转成任务"}
    </Button>
  );
}

/**
 * 会议详情：**三阶段闭环**（prd-routines 3）。
 *
 *   会前  议题池 → 议程
 *   会中  写纪要
 *   会后  决议 → 任务
 *
 * 三块按这个顺序竖排，因为开会本身就是这个顺序，中间不该来回跳。
 */
export function MeetingDetail({
  meetingId,
  agenda,
  minutes,
  resolutions,
  pool,
  transcriptionEnabled,
  cloudTranscription,
  asrConfigured,
  minutesConfigured,
  recordings,
}: {
  meetingId: string;
  agenda: string[];
  minutes: string | null;
  resolutions: Resolution[];
  pool: PoolItem[];
  transcriptionEnabled: boolean;
  cloudTranscription: boolean;
  asrConfigured: boolean;
  minutesConfigured: boolean;
  recordings: RecordingPanelItem[];
}) {
  const [minutesState, minutesAction] = useActionState(
    saveMinutes.bind(null, meetingId),
    IDLE_FORM_STATE,
  );
  const [resolutionState, resolutionAction] = useActionState(
    addResolution.bind(null, meetingId),
    IDLE_FORM_STATE,
  );

  return (
    <div className="space-y-6">
      <RecordingPanel
        meetingId={meetingId}
        transcriptionEnabled={transcriptionEnabled}
        cloudTranscription={cloudTranscription}
        asrConfigured={asrConfigured}
        minutesConfigured={minutesConfigured}
        recordings={recordings}
        toggleAction={setMeetingTranscriptionEnabled.bind(null, meetingId)}
      />
      {/* ── 会前：议程 ── */}
      <section className="surface space-y-4 p-5">
        <h2 className="text-sm font-medium">议程</h2>

        {agenda.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有议程条目。</p>
        ) : (
          <ol className="space-y-2">
            {agenda.map((entry, index) => (
              <li key={`${entry}-${index}`} className="flex items-start gap-2 text-sm">
                <span className="w-5 shrink-0 tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1">{entry}</span>
                {/* 硬删、找不回来，走确认（CLAUDE.md 删除模型） */}
                <ConfirmSubmitButton
                  action={removeAgendaEntry.bind(null, meetingId, index)}
                  message={`删除议程「${entry}」？删掉就没有了。`}
                  size="icon-sm"
                  label={`删除议程 ${entry}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </ConfirmSubmitButton>
              </li>
            ))}
          </ol>
        )}

        <form action={addAgendaEntry.bind(null, meetingId)} className="flex gap-2">
          <Input name="text" placeholder="直接加一条议程" className="flex-1" required />
          <SubmitButton label="加入" />
        </form>

        {pool.length > 0 ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">从议题池拉进来</p>
            <ul className="flex flex-wrap gap-2">
              {pool.map((item) => (
                <li key={item.id}>
                  <form action={pullAgendaItem.bind(null, meetingId, item.id)}>
                    <PullPoolItemButton content={item.content} />
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* ── 会中：纪要 ── */}
      <form key={minutes ?? ""} action={minutesAction} className="surface space-y-3 p-5">
        <input type="hidden" name="originalMinutes" value={minutes ?? ""} />
        <Label htmlFor="minutes" className="text-sm font-medium">
          纪要
        </Label>
        <Textarea
          id="minutes"
          name="minutes"
          rows={8}
          defaultValue={minutes ?? ""}
          placeholder="会上讲了什么、定了什么"
        />
        <div className="flex items-center gap-3">
          <SubmitButton label="保存纪要" />
          {minutesState.message ? (
            <span
              className={
                formMessageClass(minutesState.ok)
              }
            >
              {minutesState.message}
            </span>
          ) : null}
        </div>
      </form>

      {/* ── 会后：决议 → 任务 ── */}
      <section className="surface space-y-4 p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">决议</h2>
          <p className="text-xs text-muted-foreground">
            定下来的事转成任务，散会就出现在待办里——不用再从纪要里抄一遍。
          </p>
        </div>

        {resolutions.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有决议。</p>
        ) : (
          <ul className="space-y-2">
            {resolutions.map((resolution, index) => {
              const expected = resolutionSnapshot(resolution);
              return <li
                key={`${resolution.text}-${index}`}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{resolution.text}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{resolution.assignee}</span>
                    {resolution.dueDate ? <span>{resolution.dueDate} 前</span> : null}
                  </p>
                </div>

                {resolution.convertedTaskId ? (
                  // 已转过的不给按钮——同一条决议转两次会造出两条重复待办
                  <Link
                    href="/tasks"
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    已转任务
                  </Link>
                ) : (
                  <form action={convertResolutionToTask.bind(null, meetingId, index, expected)}>
                    <ConvertToTaskButton />
                  </form>
                )}

                <ConfirmSubmitButton
                  action={removeResolution.bind(null, meetingId, index, expected)}
                  message={`删除决议「${resolution.text}」？删掉就没有了。`}
                  size="icon-sm"
                  label={`删除决议 ${resolution.text}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </ConfirmSubmitButton>
              </li>;
            })}
          </ul>
        )}

        <form action={resolutionAction} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]">
          <Input name="text" placeholder="决议内容" required />
          <Input name="assignee" placeholder="谁来做" defaultValue="我" />
          <Input name="dueDate" type="date" />
          <SubmitButton label="记下" />
        </form>
        {resolutionState.message ? (
          <span
            className={
              formMessageClass(resolutionState.ok)
            }
          >
            {resolutionState.message}
          </span>
        ) : null}
      </section>
    </div>
  );
}
