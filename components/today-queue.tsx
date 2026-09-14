import Link from "next/link";
import { ListChecks } from "lucide-react";
import { DecorTile } from "@/components/decor-tile";
import { TeaCupArt } from "@/components/empty-art";
import { TASK_SOURCE_LABELS } from "@/lib/labels";
import { dueHint, type TaskLike } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import type {
  TaskPriority,
  TaskSource,
  TaskStatus,
} from "@/lib/generated/prisma/enums";

export type TodayQueueTask = TaskLike & {
  id: string;
  title: string;
  source: TaskSource;
  priority: TaskPriority;
  status: TaskStatus;
  relatedProject: {
    id: string;
    title: string;
    shortTitle: string | null;
  } | null;
};

const TONE_CLASS = {
  overdue: "text-[var(--h-amber-fg)]",
  today: "font-medium text-foreground",
  normal: "text-muted-foreground",
} as const;

/**
 * 首页「今天要处理」（PRD 第 2 节）。
 *
 * **只放能被处理掉的事**：逾期的、今天到期的、高优先级的。
 * 完整列表在 `/tasks`——首页放全量就和「日常」模块重复了，
 * 这条边界必须守住，否则两个页面会长成一样。
 *
 * 判据：首页上的每一条都应该是"处理完就消失"的。
 *
 * **这一块以前叫「收件箱」，二期 2.6 改了名。** 「收件箱」现在专指
 * 待归类的速记（`components/capture-inbox.tsx`），两个都叫收件箱的话，
 * 用户会说不清自己随手记的那条在哪个箱子里。
 */
export function TodayQueue({
  tasks,
  overflow = 0,
}: {
  tasks: TodayQueueTask[];
  /** 超出首页上限（capForHome）没显示出来的条数。计数徽章仍显示总数 */
  overflow?: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <DecorTile icon={ListChecks} domain="task" />
        <h2 className="text-base font-semibold">今天要处理</h2>
        {tasks.length + overflow > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {tasks.length + overflow}
          </span>
        ) : null}
        <Link
          href="/tasks"
          className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          全部任务 →
        </Link>
      </div>

      {/* 空状态不能返回 null：首页是两栏布局，左栏塌掉会让右栏孤零零地飘着。
          底色走中间调（well）不是白卡：空着的格子是「虚」的，
          和装着任务的白卡拉开一档，清完的那一刻页面自己会松下来 */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
          <TeaCupArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            今天没有等着处理的事。逾期的、今天到期的、标了「高」优先级的会出现在这里。
          </p>
        </div>
      ) : null}

      {/* 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片）。
          原来一条任务一张 .surface，十六条就是十六张卡叠一屏 */}
      {tasks.length > 0 ? (
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {tasks.map((task) => {
            const hint = dueHint(task);
            return (
              <li
                key={task.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
              >
                {/* `max-sm:basis-full` 同 task-row.tsx：窄屏上标题独占一行，
                    否则会被右侧徽章群挤成一字一竖行 */}
                <Link
                  href="/tasks"
                  className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline max-sm:basis-full"
                >
                  {task.title}
                </Link>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      task.source === "SUPERIOR"
                        ? "border-foreground/25 font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {TASK_SOURCE_LABELS[task.source]}
                  </span>
                  {task.relatedProject ? (
                    <Link
                      href={`/projects/${task.relatedProject.id}`}
                      className="text-muted-foreground underline-offset-4 hover:underline"
                    >
                      {task.relatedProject.shortTitle ??
                        task.relatedProject.title}
                    </Link>
                  ) : null}
                  {hint ? (
                    <span className={TONE_CLASS[hint.tone]}>{hint.text}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* 溢出行和收件箱同一副面孔（capture-inbox.tsx）：裁掉的不是丢了，
          是排在后面——最紧急的 8 条处理完，剩下的自然浮上来 */}
      {overflow > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          还有 {overflow} 条没显示。
          <Link href="/tasks" className="ml-1 underline underline-offset-4">
            去任务页看全部
          </Link>
        </p>
      ) : null}
    </section>
  );
}
