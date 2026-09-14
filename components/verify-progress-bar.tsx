import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { VerifyProgress } from "@/lib/export/preflight";

/**
 * 目标年度的核实进度（二期 2.4）。
 *
 * **为什么需要它**：待核实视图是「筛掉已核实的」，清完一条那条就从列表消失，
 * 屏幕上永远只剩没做的——看不出做了多少、还剩多少，也分不清哪些属于今年
 * （该清）哪些是历史账（不用清）。清 24 条中途没有任何进度反馈很容易放弃。
 *
 * 只在「待核实」视图显示。台账视图上它是噪音。
 */
export function VerifyProgressBar({
  progress,
  /** 当前是否已经筛到了目标年度。没筛就给一个一键聚焦的入口 */
  scopedToYear,
}: {
  progress: VerifyProgress;
  scopedToYear: boolean;
}) {
  const done = progress.remaining === 0;

  return (
    <section className="surface space-y-2.5 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">
          {progress.year} 年度申报候选
        </h2>

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
            <span className="mx-2 opacity-40">·</span>
            还剩{" "}
            <span className="font-medium text-foreground tabular-nums">{progress.remaining}</span>{" "}
            条
          </span>
        )}

        {!done && !scopedToYear ? (
          <Link
            href={`/achievements?scope=all&unverified=1&year=${progress.year}`}
            className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            只看这 {progress.remaining} 条 →
          </Link>
        ) : null}
      </div>

      {/* 进度条。**不用健康度那六个语义色**——绿色在本工具里指「结题要求已齐备」，
          这里借用会让看板上的绿点失去信号价值。用 primary（墨黑）就够了 */}
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
        <p className="text-xs leading-relaxed text-muted-foreground">
          每行点「订正」，改状态、填分、勾「已核实」，保存后这条就从列表里消失。
          {scopedToYear ? null : (
            <span> 列表里还混着历史年度的记录，那些不用现在清。</span>
          )}
        </p>
      )}
    </section>
  );
}
