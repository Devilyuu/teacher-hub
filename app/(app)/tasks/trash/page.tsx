import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { InboxTrayArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import { getTrashedTasks } from "@/lib/queries/routines";
import { purgeTask, restoreTask } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "任务回收站" };

/**
 * 任务回收站。
 *
 * 删除按钮上写着「移入回收站」，这一页就是那句话的兑现——
 * 后端的 `restoreTask` / `purgeTask` 早就写好了，但一直没有界面入口，
 * 文案承诺了一件用户做不到的事。
 *
 * 恢复不问、彻底删除才问：前者随时可以再删一次，后者没有第二次机会。
 * 不做自动过期清理——单人使用、任务行很小，攒一年也占不了多少地方，
 * 而"我半年前删的那条"恰恰是回收站最常被翻的用途。
 */
export default async function TaskTrashPage() {
  const tasks = await getTrashedTasks();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3 pt-2">
        <Link
          href="/tasks"
          aria-label="返回任务列表"
          className="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:text-foreground"
          style={{ boxShadow: "var(--shadow-pill)" }}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="space-y-2">
          <h1 className="page-title">任务回收站</h1>
          <p className="measure text-muted-foreground">
            删掉的任务都在这里，可以恢复，也可以彻底删除。不会自动清空。
          </p>
        </div>
      </header>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-well px-4 py-10 text-center">
          <InboxTrayArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm">回收站是空的</p>
          <p className="text-xs text-muted-foreground">在任务列表里删掉的任务会先放到这里。</p>
        </div>
      ) : (
        <ul className="surface divide-y">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.deletedAt ? `${formatTimestamp(task.deletedAt)} 删除` : null}
                  {task.relatedProject ? (
                    <span className="ml-2">
                      · {task.relatedProject.shortTitle ?? task.relatedProject.title}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <form action={restoreTask.bind(null, task.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    <RotateCcw className="size-3.5" aria-hidden />
                    恢复
                  </Button>
                </form>
                <ConfirmSubmitButton
                  action={purgeTask.bind(null, task.id)}
                  message={`彻底删除「${task.title}」？删了就找不回来了。`}
                  className="text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  彻底删除
                </ConfirmSubmitButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
