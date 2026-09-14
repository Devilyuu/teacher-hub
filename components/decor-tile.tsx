import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 装饰色**按功能域分**，不按位置随手配：同一类东西在首页上永远是同一个颜色，
 * 用久了看颜色就能找到那一块。和首页四张数字卡原有的配色对齐——
 * 今日到期（任务）蓝、本周会议紫、90 天内到期（课题）琥珀。
 *
 * 装饰色板一共五档（globals.css --decor-*），现有五个域刚好用满。
 * 再加域之前先想清楚它能不能归进已有的某一个——**不许两个域共用一色**，
 * 那样「颜色 = 哪类东西」这条约定就失效了。
 *
 * 形态锁死在 `.ico-tile`：淡底 + 线性图标，永不实心、永不带语义（CLAUDE.md 视觉语言）。
 */
export const DECOR_DOMAIN_TONES = {
  task: "blue",
  meeting: "violet",
  project: "amber",
  capture: "teal",
  teaching: "rose",
} as const;

export type DecorDomain = keyof typeof DECOR_DOMAIN_TONES;

export function DecorTile({
  icon: Icon,
  domain,
  className,
}: {
  icon: LucideIcon;
  domain: DecorDomain;
  className?: string;
}) {
  const tone = DECOR_DOMAIN_TONES[domain];
  return (
    <span
      className={cn("ico-tile", className)}
      style={
        {
          "--tile": `var(--decor-${tone})`,
          "--tile-bg": `var(--decor-${tone}-bg)`,
        } as React.CSSProperties
      }
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
