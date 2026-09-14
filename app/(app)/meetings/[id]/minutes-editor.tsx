"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formMessageClass, type FormState } from "@/lib/form-state";
import { createManualCandidateId } from "@/lib/minutes/client-flow";
import type { MinutesDraft } from "@/lib/minutes/schema";
import { confirmMinutesAction, saveMinutesDraftAction } from "../minutes-actions";

type Resolution = MinutesDraft["resolutions"][number];
type Task = MinutesDraft["tasks"][number];
type OpenIssue = MinutesDraft["openIssues"][number];


export function MinutesEditor({
  recordingId,
  meetingId,
  initialDraft,
}: {
  recordingId: string;
  meetingId: string;
  initialDraft: MinutesDraft;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [feedback, setFeedback] = useState<FormState>({ ok: false });
  const [pending, startTransition] = useTransition();

  function updateResolution(id: string, patch: Partial<Resolution>) {
    setDraft((current) => ({
      ...current,
      resolutions: current.resolutions.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function updateTask(id: string, patch: Partial<Task>) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function updateIssue(id: string, patch: Partial<OpenIssue>) {
    setDraft((current) => ({
      ...current,
      openIssues: current.openIssues.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function save(current: MinutesDraft) {
    const formData = new FormData();
    formData.set("draft", JSON.stringify(current));
    return saveMinutesDraftAction(recordingId, meetingId, { ok: false }, formData);
  }

  function saveDraft() {
    if (!formRef.current?.reportValidity()) return;
    startTransition(async () => {
      setFeedback({ ok: false });
      setFeedback(await save(draft));
    });
  }

  function confirmDraft() {
    if (!formRef.current?.reportValidity()) return;
    startTransition(async () => {
      setFeedback({ ok: false });
      try {
        const formData = new FormData();
        formData.set("draft", JSON.stringify(draft));
        setFeedback(await confirmMinutesAction(recordingId, meetingId, formData));
      } catch {
        setFeedback({ ok: false, tone: "error", message: "纪要确认失败，未创建任何任务" });
      }
    });
  }

  const hasContent = Boolean(
    draft.summary.trim()
      || draft.discussion.trim()
      || draft.resolutions.length
      || draft.tasks.length
      || draft.openIssues.length,
  );
  const selectedTasks = draft.tasks.filter((task) => task.selected).length;

  return (
    <form
      ref={formRef}
      className="mt-4 space-y-5 rounded-xl border border-border/70 bg-muted/25 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        saveDraft();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <p className="text-sm font-medium">纪要工作台</p>
          <p className="mt-1 text-xs text-muted-foreground">AI 只提供草稿；确认时会原子保存当前完整内容。</p>
        </div>
        <span className="rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">
          将创建 {selectedTasks} 项任务
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${recordingId}-summary`}>会议摘要</Label>
          <Textarea
            id={`${recordingId}-summary`}
            value={draft.summary}
            rows={5}
            placeholder="用几句话概括会议结论"
            disabled={pending}
            onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${recordingId}-discussion`}>主要讨论</Label>
          <Textarea
            id={`${recordingId}-discussion`}
            value={draft.discussion}
            rows={5}
            placeholder="记录关键分歧、依据和讨论过程"
            disabled={pending}
            onChange={(event) => setDraft((current) => ({ ...current, discussion: event.target.value }))}
          />
        </div>
      </div>

      <CandidateSection
        title="决议"
        hint="确认后写入正式会议记录"
        onAdd={() => setDraft((current) => ({
          ...current,
          resolutions: [...current.resolutions, {
            id: createManualCandidateId("resolution"),
            text: "",
            assignee: "我",
            dueDate: null,
          }],
        }))}
      >
        {draft.resolutions.length === 0 ? <EmptyRow text="还没有决议" /> : draft.resolutions.map((resolution, index) => (
          <div key={resolution.id} className="grid gap-2 rounded-xl bg-well p-3 md:grid-cols-[minmax(0,1fr)_8rem_9rem_auto]">
            <Field label={`决议 ${index + 1}`} htmlFor={`${resolution.id}-text`}>
              <Input id={`${resolution.id}-text`} value={resolution.text} required disabled={pending} onChange={(event) => updateResolution(resolution.id, { text: event.target.value })} />
            </Field>
            <Field label="负责人" htmlFor={`${resolution.id}-assignee`}>
              <Input id={`${resolution.id}-assignee`} value={resolution.assignee} required disabled={pending} onChange={(event) => updateResolution(resolution.id, { assignee: event.target.value })} />
            </Field>
            <Field label="日期" htmlFor={`${resolution.id}-due`}>
              <Input id={`${resolution.id}-due`} type="date" value={resolution.dueDate ?? ""} disabled={pending} onChange={(event) => updateResolution(resolution.id, { dueDate: event.target.value || null })} />
            </Field>
            <RemoveButton label={`删除决议 ${index + 1}`} disabled={pending} onClick={() => setDraft((current) => ({ ...current, resolutions: current.resolutions.filter((item) => item.id !== resolution.id) }))} />
          </div>
        ))}
      </CandidateSection>

      <CandidateSection
        title="候选任务"
        hint="只创建勾选的任务"
        onAdd={() => setDraft((current) => ({
          ...current,
          tasks: [...current.tasks, {
            id: createManualCandidateId("task"),
            title: "",
            assignee: "我",
            dueDate: null,
            selected: true,
            createdTaskId: null,
          }],
        }))}
      >
        {draft.tasks.length === 0 ? <EmptyRow text="还没有候选任务" /> : draft.tasks.map((task, index) => (
          <div key={task.id} className="grid gap-2 rounded-xl bg-well p-3 md:grid-cols-[auto_minmax(0,1fr)_8rem_9rem_auto]">
            <label className="flex min-h-8 items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={task.selected} disabled={pending} onChange={(event) => updateTask(task.id, { selected: event.target.checked })} />
              创建
            </label>
            <Field label={`任务 ${index + 1}`} htmlFor={`${task.id}-title`}>
              <Input id={`${task.id}-title`} value={task.title} required disabled={pending} onChange={(event) => updateTask(task.id, { title: event.target.value })} />
            </Field>
            <Field label="负责人" htmlFor={`${task.id}-assignee`}>
              <Input id={`${task.id}-assignee`} value={task.assignee} required disabled={pending} onChange={(event) => updateTask(task.id, { assignee: event.target.value })} />
            </Field>
            <Field label="截止日" htmlFor={`${task.id}-due`}>
              <Input id={`${task.id}-due`} type="date" value={task.dueDate ?? ""} disabled={pending} onChange={(event) => updateTask(task.id, { dueDate: event.target.value || null })} />
            </Field>
            <RemoveButton label={`删除任务 ${index + 1}`} disabled={pending} onClick={() => setDraft((current) => ({ ...current, tasks: current.tasks.filter((item) => item.id !== task.id) }))} />
          </div>
        ))}
      </CandidateSection>

      <CandidateSection
        title="未决问题"
        hint="保留到正式纪要中，便于下次跟进"
        onAdd={() => setDraft((current) => ({
          ...current,
          openIssues: [...current.openIssues, { id: createManualCandidateId("issue"), text: "" }],
        }))}
      >
        {draft.openIssues.length === 0 ? <EmptyRow text="还没有未决问题" /> : draft.openIssues.map((issue, index) => (
          <div key={issue.id} className="flex items-end gap-2 rounded-xl bg-well p-3">
            <Field label={`问题 ${index + 1}`} htmlFor={`${issue.id}-text`} className="flex-1">
              <Input id={`${issue.id}-text`} value={issue.text} required disabled={pending} onChange={(event) => updateIssue(issue.id, { text: event.target.value })} />
            </Field>
            <RemoveButton label={`删除问题 ${index + 1}`} disabled={pending} onClick={() => setDraft((current) => ({ ...current, openIssues: current.openIssues.filter((item) => item.id !== issue.id) }))} />
          </div>
        ))}
      </CandidateSection>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "保存中…" : "保存草稿"}
        </Button>
        <Button type="button" size="sm" disabled={pending || !hasContent} onClick={confirmDraft}>
          确认纪要并创建所选任务
        </Button>
        {feedback.message ? <p className={formMessageClass(feedback.ok)} aria-live="polite">{feedback.message}</p> : null}
      </div>
    </form>
  );
}

function CandidateSection({
  title,
  hint,
  onAdd,
  children,
}: {
  title: string;
  hint: string;
  onAdd(): void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <Button className="ml-auto" type="button" size="sm" variant="ghost" onClick={onAdd}>
          <Plus className="size-3.5" aria-hidden /> 添加
        </Button>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs" htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick(): void }) {
  return (
    <Button className="self-end" type="button" size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>
      <Trash2 className="size-3.5" aria-hidden />
    </Button>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">{text}</p>;
}
