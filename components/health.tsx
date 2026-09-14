import type { ProjectHealth } from "@/lib/gap";
import { HEALTH_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * 健康度配色。**这六个色相是本工具唯一的语义色**——
 * 看板一眼扫过去判断"哪个课题要出事"全靠它们。
 *
 * 色值全部来自 app/globals.css 的 `--h-*` 令牌，两套主题各一份，
 * 这里只引用不定义。**别在这个文件里写 Tailwind 调色板的类**
 * （bg-red-50 之类）：那样深色要再抄一遍，而深色的雾面色不在调色板里。
 *
 * 2026-09-12 改版后，语义色不再靠"独占色相"跟界面其他部分区分——
 * 主色是青绿、功能图标也有一整排彩色。**区分改为靠形态**：
 *
 *   语义（这里）  = 实心高饱和圆点 ＋ 文字标签 ＋ 胶囊底
 *   装饰（.ico-tile）= 淡底 11~15% ＋ 线性描边图标，永不实心
 *
 * 亮度差比色相差更早被眼睛抓到，所以即使都用绿也不混。
 *
 * **文字标签永远在**，这是最硬的一道保险：色弱的人、黑白打印出来的
 * 结题材料，都还读得出"已齐备"三个字。上一版纯靠颜色的圆点做不到。
 *
 * 深色下的辉光去掉了。它配的是上一版的高饱和原色；雾面色发光只会发脏，
 * 边界改由 .health-badge 的同色内环（--badge-ring）交代。
 */
const HEALTH_STYLES: Record<ProjectHealth, { dot: string; badge: string; ring: string }> = {
  RED: {
    dot: "bg-[var(--h-red)]",
    badge: "bg-[var(--h-red-bg)] text-[var(--h-red-fg)]",
    ring: "text-[var(--h-red)]",
  },
  ORANGE: {
    dot: "bg-[var(--h-orange)]",
    badge: "bg-[var(--h-orange-bg)] text-[var(--h-orange-fg)]",
    ring: "text-[var(--h-orange)]",
  },
  YELLOW: {
    dot: "bg-[var(--h-amber)]",
    badge: "bg-[var(--h-amber-bg)] text-[var(--h-amber-fg)]",
    ring: "text-[var(--h-amber)]",
  },
  GREEN: {
    dot: "bg-[var(--h-green)]",
    badge: "bg-[var(--h-green-bg)] text-[var(--h-green-fg)]",
    ring: "text-[var(--h-green)]",
  },
  BLUE: {
    dot: "bg-[var(--h-blue)]",
    badge: "bg-[var(--h-blue-bg)] text-[var(--h-blue-fg)]",
    ring: "text-[var(--h-blue)]",
  },
  UNSET: {
    dot: "bg-[var(--h-violet)]",
    badge: "bg-[var(--h-violet-bg)] text-[var(--h-violet-fg)]",
    ring: "text-[var(--h-violet)]",
  },
  GREY: {
    dot: "bg-[var(--h-grey)]",
    badge: "bg-[var(--h-grey-bg)] text-[var(--h-grey-fg)]",
    ring: "text-[var(--h-grey)]",
  },
};

export function healthStyle(health: ProjectHealth) {
  return HEALTH_STYLES[health];
}

/** 卡片排序用。RED 置顶（PRD 4.1） */
const HEALTH_RANK: Record<ProjectHealth, number> = {
  RED: 0,
  ORANGE: 1,
  YELLOW: 2,
  UNSET: 3,
  BLUE: 4,
  GREEN: 5,
  GREY: 6,
};

export function compareByHealth(a: ProjectHealth, b: ProjectHealth): number {
  return HEALTH_RANK[a] - HEALTH_RANK[b];
}

export function HealthBadge({ health, className }: { health: ProjectHealth; className?: string }) {
  return (
    <span
      className={cn("health-badge", HEALTH_STYLES[health].badge, className)}
    >
      <span className={cn("size-1.5 rounded-full", HEALTH_STYLES[health].dot)} aria-hidden />
      {HEALTH_LABELS[health]}
    </span>
  );
}

/**
 * 完成度环形进度。圆头线帽、留一圈浅色轨道，学参考稿的环形图。
 *
 * rate 为 null 时画一个空环加"—"，**绝不画成 0%**——
 * 「没录要求所以算不出」和「录了但一项没达成」是两回事（PRD 第 3 节）。
 */
export function CompletionRing({
  rate,
  health,
  size = 48,
  label,
}: {
  rate: number | null;
  health: ProjectHealth;
  size?: number;
  /** 环中间显示的文字，默认是百分数 */
  label?: string;
}) {
  const stroke = Math.max(4, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = rate == null ? 0 : Math.max(0, Math.min(1, rate));
  const text = label ?? (rate == null ? "—" : `${Math.round(rate * 100)}`);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={rate == null ? "完成度未知" : `完成度 ${Math.round(rate * 100)}%`}
    >
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-muted"
        />
        {filled > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - filled)}
            className={cn("stroke-current transition-[stroke-dashoffset] duration-500", HEALTH_STYLES[health].ring)}
          />
        ) : null}
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-medium tabular-nums"
        style={{ fontSize: Math.max(10, Math.round(size * 0.26)) }}
      >
        {text}
      </span>
    </div>
  );
}
