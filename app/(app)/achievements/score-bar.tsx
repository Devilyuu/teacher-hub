import {
  PROMOTION_SCORE_UNCATEGORIZED,
  type PromotionScoreSlice,
} from "@/lib/outcomes/facets";

/**
 * 职称量化分按一级指标的单色堆叠条。
 *
 * **单色阶，不是六个颜色。** 红/橙/黄/绿/蓝/紫全被健康度占着
 * （CLAUDE.md 视觉语言），这里用墨色的深浅表示序：字典表 1→6 由深到浅，
 * 「未挂指标」永远是最浅的那档虚位——它是待清的账，不配实色。
 * 深浅只编码顺序不编码含义，读数看下面的图例。
 */
const SHADES = [
  "bg-foreground/85",
  "bg-foreground/66",
  "bg-foreground/50",
  "bg-foreground/38",
  "bg-foreground/28",
  "bg-foreground/20",
];
const UNCATEGORIZED_SHADE = "bg-foreground/10";

/** 0.30000000000000004 这种浮点尾巴不该出现在图例里 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function PromotionScoreBar({
  slices,
  deducted,
}: {
  slices: PromotionScoreSlice[];
  deducted: number;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.score, 0);
  if (total <= 0) return null;

  const shadeOf = (slice: PromotionScoreSlice, index: number) =>
    slice.major === PROMOTION_SCORE_UNCATEGORIZED
      ? UNCATEGORIZED_SHADE
      : SHADES[Math.min(index, SHADES.length - 1)];

  return (
    <div className="space-y-2">
      <div
        className="flex h-2 max-w-xl gap-px overflow-hidden rounded-full"
        aria-hidden
      >
        {slices.map((slice, index) => (
          <div
            key={slice.major}
            className={shadeOf(slice, index)}
            style={{ width: `${(slice.score / total) * 100}%` }}
            title={`${slice.major} ${round2(slice.score)} 分`}
          />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {slices.map((slice, index) => (
          <span key={slice.major} className="flex items-center gap-1.5">
            <span
              className={`size-2 shrink-0 rounded-[3px] ${shadeOf(slice, index)}`}
              aria-hidden
            />
            {slice.major}{" "}
            <span className="tabular-nums text-foreground">
              {round2(slice.score)}
            </span>
          </span>
        ))}
        {deducted < 0 ? (
          <span>
            另有扣分{" "}
            <span className="tabular-nums text-foreground">
              {round2(deducted)}
            </span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
