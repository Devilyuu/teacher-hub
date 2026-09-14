import type { Metadata } from "next";
import Link from "next/link";
import {
  countTrashedTasks,
  ensureRecurringTasks,
  getTaskProjectOptions,
  getTasks,
} from "@/lib/queries/routines";
import { TaskBoard } from "./task-board";

import { RoutineTabs } from "@/components/routine-tabs";
import { getEnabledModules } from "@/lib/module-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "任务" };

export default async function TasksPage() {
  // 周期任务在这里补生成——没有 cron，「当天第一次打开任务页」就是触发点
  // （见 lib/recurring.ts 文件头）。靠 lastRunYmd 原子认领，重复打开不会重复建
  await ensureRecurringTasks();

  const [tasks, projects, modules, trashed] = await Promise.all([
    getTasks(),
    getTaskProjectOptions(),
    getEnabledModules(),
    countTrashedTasks(),
  ]);

  return (
    <div className="space-y-6">
      <RoutineTabs modules={modules} />

      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">任务</h1>
          <p className="measure text-muted-foreground">
            上级布置、例会派发、自我待办，都记在这里。逾期的排最前面。
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/tasks/recurring"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            周期任务规则
          </Link>
          {/* 回收站入口常驻，空的时候也在——删除按钮写着「移入回收站」，
              用户得知道去哪找，而不是删过一次之后入口才冒出来 */}
          <Link
            href="/tasks/trash"
            className="text-sm text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline"
          >
            回收站{trashed > 0 ? ` · ${trashed}` : ""}
          </Link>
        </div>
      </header>

      <TaskBoard tasks={tasks} projects={projects} />
    </div>
  );
}
