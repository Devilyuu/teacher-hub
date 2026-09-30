import { cookies } from "next/headers";
import Link from "next/link";
import { Circle, CircleCheck } from "lucide-react";
import { dismissGettingStarted } from "@/lib/actions/getting-started-actions";
import { prisma } from "@/lib/db";
import {
  GETTING_STARTED_DISMISSED_COOKIE,
  gettingStartedSteps,
  shouldShowGettingStarted,
} from "@/lib/getting-started";
import { getRuleTablesSummary } from "@/lib/queries/rule-tables";
import { cn } from "@/lib/utils";

/**
 * 首页「开始使用」：刚装好的人先做的三件事（口径在 lib/getting-started.ts）。
 * 全做完、或点过「不再显示」，一个字节都不占——服务器上用了几年的库永远看不到它。
 *
 * 不配装饰色图标：它不属于任何一个功能域，而装饰色是按域分的、五档已经用满（CLAUDE.md 视觉语言）
 */
export async function GettingStarted() {
  if ((await cookies()).get(GETTING_STARTED_DISMISSED_COOKIE)?.value === "1") return null;

  const [profile, rules, timetableSlots] = await Promise.all([
    prisma.profile.findFirst({ select: { name: true, unit: true, currentTitleSince: true } }),
    getRuleTablesSummary(),
    prisma.timetableSlot.count(),
  ]);
  const steps = gettingStartedSteps({
    profile,
    promotionCategories: rules.promotion?.count ?? 0,
    perfCategories: rules.perf?.count ?? 0,
    timetableSlots,
  });
  if (!shouldShowGettingStarted(steps, false)) return null;
  const remaining = steps.filter((step) => !step.done).length;

  return (
    <section className="space-y-3" aria-labelledby="getting-started-title">
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <h2 id="getting-started-title" className="text-base font-semibold">
          开始使用
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          还差 {remaining} 步
        </span>
        <form action={dismissGettingStarted} className="ml-auto">
          <button
            type="submit"
            className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            不再显示
          </button>
        </form>
      </div>
      <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3 px-4 py-3">
            {step.done ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className={cn("text-sm font-medium", step.done && "text-muted-foreground")}>
                {step.title}
              </p>
              {step.done ? null : (
                <p className="measure text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              )}
            </div>
            {step.done ? (
              <span className="shrink-0 text-xs text-muted-foreground">已完成</span>
            ) : (
              <Link
                href={step.href}
                className="shrink-0 text-sm text-primary underline-offset-4 hover:underline"
              >
                {step.action} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
