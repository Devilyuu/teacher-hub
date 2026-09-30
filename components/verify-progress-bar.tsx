import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { VerifyProgress } from "@/lib/export/preflight";

/**
 * 目标年度的核实进度（二期 2.4；2026-09-25 成果页合并后接回）。
 *
 * **为什么需要它**：待核实视图是「筛掉已核实的」，清完一条那条就从列表消失，
 * 屏幕上永远只剩没做的——看不出做了多少、还剩多少，也分不清哪些属于今年
 * （该清）哪些是历史账（不用清）。清 24 条中途没有任何进度反馈很容易放弃。
 * 口径见 `verifyProgress`（和导出预检是同一套）。
 *
 * 只在「待核实」视图显示。台账视图上它是噪音。
 */
export function VerifyProgressBar({
  progress,
  focusYearHref,
}: {
  progress: VerifyProgress;
  /**
   * 「只看这一年」的链接，由页面按当前筛选拼好（保留口径等其余参数）。
   * 已经筛到这一年时传 null——不再给入口
   */
  focusYearHref: string | null;
}) {
  if (progress.total === 0) {
    return (
      <section className="rounded-2xl bg-well px-4 py-3 text-sm text-muted-foreground">
        {progress.year} 年还没有挂了分类的申报候选要核实。
      </section>
    );
  }

  const done = progress.remaining === 0;

  return (
    <section className="surface space-y-2.5 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">{progress.year} 年度申报候选</h2>

        {done ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {progress.total} 条全部核实完了
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            已核实{" "}
            <span className="font-medium text-foreground tabular-nums">{progress.verified}</span>
            {" / "}
            <span className="tabular-nums">{progress.total}</span>
            <span className="mx-2" aria-hidden>
              ·
            </span>
            还剩{" "}
            <span className="font-medium text-foreground tabular-nums">{progress.remaining}</span>{" "}
            条
          </span>
        )}

        {/* 不写「只看这 N 条」：列表里还有没挂分类的待核实成果，课题的几条绩效事项
            也合在一行里显示，点过去行数和 N 对不上，文案就成了兑现不了的承诺 */}
        {!done && focusYearHref ? (
          <Link
            href={focusYearHref}
            className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            只看 {progress.year} 年 →
          </Link>
        ) : null}
      </div>

      {/* 进度条。**不用健康度那六个语义色**——绿色在本工具里指「结题要求已齐备」，
          这里借用会让看板上的绿点失去信号价值。用主色就够了 */}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress.year} 年度核实进度`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {done ? null : (
        // 中文句子不能跨行写：JSX 会在换行处补一个空格，句号后面就多出一格
        <p className="measure text-xs leading-relaxed text-muted-foreground">
          {"成果点标题旁的「订正」勾上「已核实」；课题的绩效事项到课题详情的绩效面板里逐条核实。"}
          {"核实完的会从列表里消失。课题本身没有核实这一步，不算在这个数里。"}
          {focusYearHref ? "列表里还混着别的年度，那些不用现在清。" : null}
        </p>
      )}
    </section>
  );
}
