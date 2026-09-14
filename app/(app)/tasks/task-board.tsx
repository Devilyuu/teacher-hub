"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { isDone, isOverdue, sortTasks } from "@/lib/tasks";
import { TaskForm, type ProjectOption } from "./task-form";
import { TaskRow, type TaskRowData } from "./task-row";

type Task = TaskRowData & { dueDate: Date | null };

/**
 * 任务列表。
 *
 * **按「逾期 / 进行中 / 稍后 / 已完成」分组，不按状态字段平铺**——
 * 每天打开先看的是"有没有事情烧起来了"，而不是"我一共有多少条待办"。
 * 逾期这一组必须在最上面。
 */
export function TaskBoard({
  tasks,
  projects,
}: {
  tasks: Task[];
  projects: ProjectOption[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const open = tasks.filter((task) => !isDone(task));
  const overdue = sortTasks(open.filter((task) => isOverdue(task)));
  const active = sortTasks(open.filter((task) => !isOverdue(task)));
  const done = tasks.filter(isDone);

  const editing = tasks.find((task) => task.id === editingId);

  return (
    <div className="space-y-4">
      {/* 主操作和课题页、成果页对齐：右上角、实心、同一个形状。
          原来这里是左侧一枚小号描边胶囊，同一个动作在三个页面长三个样 */}
      {creating ? (
        <TaskForm projects={projects} onDone={() => setCreating(false)} />
      ) : (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            新建任务
          </Button>
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <p className="px-1 text-xs text-muted-foreground">编辑任务</p>
          <TaskForm
            task={editing}
            projects={projects}
            onDone={() => setEditingId(null)}
          />
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <ClipboardArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            还没有任务。上级布置的、例会派下来的、自己想起来的，都可以记在这里。
          </p>
        </div>
      ) : null}

      <Group title="已逾期" tasks={overdue} onEdit={setEditingId} />
      <Group title="待办" tasks={active} onEdit={setEditingId} />
      <Group title="已完成" tasks={done} onEdit={setEditingId} collapsed />
    </div>
  );
}

function Group({
  title,
  tasks,
  onEdit,
  collapsed,
}: {
  title: string;
  tasks: Task[];
  onEdit: (id: string) => void;
  /** 已完成的默认折叠——它只是查证用，不该占视线 */
  collapsed?: boolean;
}) {
  if (tasks.length === 0) return null;

  // 整组一张卡，行之间只有一道分隔线（CLAUDE.md 视觉语言：「列表要密」）。
  // `overflow-hidden` 是为了让首末行的 hover 底色跟着 22px 圆角裁边
  const list = (
    <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} onEdit={() => onEdit(task.id)} />
      ))}
    </ul>
  );

  if (collapsed) {
    return (
      <details className="group">
        {/* 折叠条走中间调：已完成是「虚」的，白底胶囊会和待办列表抢视线 */}
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-well px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          {title}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
            {tasks.length}
          </span>
          <span className="text-xs group-open:hidden">展开</span>
          <span className="hidden text-xs group-open:inline">收起</span>
        </summary>
        <div className="mt-3">{list}</div>
      </details>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {tasks.length}
        </span>
      </h2>
      {list}
    </section>
  );
}
