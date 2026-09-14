"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly } from "@/lib/date";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import {
  TASK_PRIORITY_LABELS,
  TASK_SOURCE_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { createTask, updateTask } from "./actions";
import type { TaskRowData } from "./task-row";

export type ProjectOption = { id: string; title: string; shortTitle: string | null };

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

/**
 * 任务表单，新建与编辑共用。
 *
 * 表单一律用原生 `<select>`——shadcn 的 Select 值不进 FormData，
 * 而 Server Action 靠 FormData 取值（CLAUDE.md 代码约定）。
 */
export function TaskForm({
  task,
  projects,
  onDone,
}: {
  /** 不传就是新建 */
  task?: TaskRowData & { dueDate: Date | null };
  projects: ProjectOption[];
  onDone?: () => void;
}) {
  const action = task ? updateTask.bind(null, task.id) : createTask;
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="surface space-y-4 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="title">任务内容</Label>
        <Input
          id="title"
          name="title"
          defaultValue={task?.title ?? ""}
          placeholder="如「提交双高中期材料」"
          required
          aria-invalid={state.fieldErrors?.title ? true : undefined}
        />
        {state.fieldErrors?.title?.map((error) => (
          <p key={error} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="source">来源</Label>
          <select
            id="source"
            name="source"
            defaultValue={task?.source ?? "SELF"}
            className={selectClass}
          >
            {Object.entries(TASK_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="priority">优先级</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={task?.priority ?? "NORMAL"}
            className={selectClass}
          >
            {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">状态</Label>
          <select
            id="status"
            name="status"
            defaultValue={task?.status ?? "TODO"}
            className={selectClass}
          >
            {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dueDate">截止日</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={task?.dueDate ? formatDateOnly(task.dueDate) : ""}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="relatedProjectId">关联课题</Label>
        {/* 外键不是自由文本：能点进课题、能按课题聚合待办（prd-routines 2） */}
        <select
          id="relatedProjectId"
          name="relatedProjectId"
          defaultValue={task?.relatedProject?.id ?? ""}
          className={selectClass}
        >
          <option value="">不关联</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.shortTitle ?? project.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tags">标签</Label>
          <Input
            id="tags"
            name="tags"
            defaultValue={task?.tags.join(" ") ?? ""}
            placeholder="双高 期末 迎评"
          />
          <p className="text-xs text-muted-foreground">逗号、顿号或空格分隔，最多 8 个</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">备注</Label>
          <Textarea id="note" name="note" rows={2} defaultValue={task?.note ?? ""} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={task ? "保存" : "新建任务"} />
        {onDone ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            收起
          </Button>
        ) : null}
        {state.message ? (
          <span
            className={
              formMessageClass(state.ok)
            }
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
