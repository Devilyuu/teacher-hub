import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRecurringRules, getTaskProjectOptions } from "@/lib/queries/routines";
import { RecurringPanel } from "./recurring-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "周期任务规则" };

export default async function RecurringPage() {
  const [rules, projects] = await Promise.all([getRecurringRules(), getTaskProjectOptions()]);

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
          <h1 className="page-title">周期任务规则</h1>
          <p className="measure text-muted-foreground">
            「每周一填周报」这类反复出现的事，设成规则后到期自动生成任务。
            没有后台定时器——当天第一次打开任务页时补生成。
          </p>
        </div>
      </header>

      <RecurringPanel rules={rules} projects={projects} />
    </div>
  );
}
