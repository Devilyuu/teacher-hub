"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  TASK_PRIORITY_LABELS,
  TASK_SOURCE_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import { dueHint, type TaskLike } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { deleteTask, restoreTask, toggleTaskDone } from "./actions";
import type { TaskPriority, TaskSource, TaskStatus } from "@/lib/generated/prisma/enums";

export type TaskRowData = TaskLike & {
  id: string;
  title: string;
  source: TaskSource;
  priority: TaskPriority;
  status: TaskStatus;
  note: string | null;
  tags: string[];
  relatedProject: { id: string; title: string; shortTitle: string | null } | null;
};

/**
 * 来源徽章。
 *
 * **不照搬 dept-cockpit 的配色。** 那边 SELF 用绿、SUPERIOR 用红——
 * 绿色在本平台专指「结题要求已齐备」，红色是健康度的「紧急」，
 * 拿来当来源底色会让人分不清"这项达标了"还是"这是自我待办"
 * （CLAUDE.md 视觉语言：那六个语义色只由 components/health.tsx 使用）。
 *
 * 这里一律中性描边，只有「上级布置」加一点重量——它确实更要紧。
 */
function SourceBadge({ source }: { source: TaskSource }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-xs",
        source === "SUPERIOR"
          ? "border-foreground/25 font-medium text-foreground"
          : "text-muted-foreground",
      )}
    >
      {TASK_SOURCE_LABELS[source]}
    </span>
  );
}

const TONE_CLASS = {
  overdue: "text-[var(--h-amber-fg)]",
  today: "font-medium text-foreground",
  normal: "text-muted-foreground",
} as const;

export function TaskRow({ task, onEdit }: { task: TaskRowData; onEdit: () => void }) {
  const [pending, setPending] = useState(false);
  const done = task.status === "DONE";
  const hint = dueHint(task);

  return (
    // **一条任务不再是一张卡片。** 卡片墙是给看板上 25 张课题卡设计的；
    // 一条 20 字的任务独占一张 1280px 宽、86px 高的卡，
    // 七条就铺满整屏。这里改成表格式的行，整组共用一张卡（见 task-board.tsx），
    // 行与行之间只用一道分隔线
    <li className="group/row flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 transition-colors hover:bg-muted/40">
      {/* 勾选是任务页最高频的动作，而 16px 的原生复选框在手机上几乎点不中。
          外面包一层 label 撑出点击区：手机上 44px、桌面 32px，用负外边距抵掉，
          行的视觉位置一点不动 */}
      <label className="-m-2 flex shrink-0 cursor-pointer items-center justify-center self-center p-2 max-md:-m-3 max-md:p-3">
        <input
          type="checkbox"
          checked={done}
          disabled={pending}
          aria-label={done ? `标记「${task.title}」未完成` : `完成「${task.title}」`}
          onChange={async (e) => {
            setPending(true);
            await toggleTaskDone(task.id, e.target.checked);
            setPending(false);
          }}
          className="size-4 max-md:size-5"
        />
      </label>

      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* `max-sm:basis-full`：窄屏上标题独占一行。徽章和它抢同一行时，
            390px 的屏上标题只剩 340px，会被折成三四行，
            而右边徽章那一侧大片留白 */}
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            "text-left text-sm underline-offset-4 hover:underline max-sm:basis-full",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>

        {/* 徽章和标题**同一行**。原来它们各占一行，把行高翻了一倍，
            而这些标签短到完全放得进标题右边的空白里 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <SourceBadge source={task.source} />
          {task.priority !== "NORMAL" ? (
            <span className="rounded border px-1.5 py-0.5 text-muted-foreground">
              {TASK_PRIORITY_LABELS[task.priority]}优先
            </span>
          ) : null}
          {task.status === "DOING" ? (
            <span className="rounded border px-1.5 py-0.5 text-muted-foreground">
              {TASK_STATUS_LABELS.DOING}
            </span>
          ) : null}
          {hint ? <span className={TONE_CLASS[hint.tone]}>{hint.text}</span> : null}
          {/* 外键换来的：点得进课题去。自由文本时代这里只能是一段死文字 */}
          {task.relatedProject ? (
            <Link
              href={`/projects/${task.relatedProject.id}`}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              挂：{task.relatedProject.shortTitle ?? task.relatedProject.title}
            </Link>
          ) : null}
          {task.tags.map((tag) => (
            <span key={tag} className="text-muted-foreground/70">
              #{tag}
            </span>
          ))}
        </div>

        {task.note ? (
          <p className="w-full text-xs whitespace-pre-wrap text-muted-foreground">{task.note}</p>
        ) : null}
      </div>

      {/* 平时压暗，指到这一行才实体化。**不做 `opacity-0`**——
          那样在触摸屏上就永远点不到删除了，而这台机器的用户是会用手机的 */}
      {/* 删除不弹确认，删完给撤销——任务进的是回收站，找得回来。
          每删一条都问一句「确定吗」只会训练人闭眼点确定，
          等真遇到找不回来的东西时那个确认框就不起作用了 */}
      <form
        action={async () => {
          await deleteTask(task.id);
          // 停 8 秒：sonner 默认 4 秒，实测手机上还没反应过来撤销按钮就没了
          toast("已移入回收站", {
            description: task.title,
            duration: 8000,
            action: { label: "撤销", onClick: () => void restoreTask(task.id) },
          });
        }}
        className="shrink-0 self-center opacity-40 transition-opacity group-hover/row:opacity-100"
      >
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title="移入回收站"
          aria-label={`删除 ${task.title}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </form>
    </li>
  );
}
