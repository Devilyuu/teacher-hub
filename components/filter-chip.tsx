import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * 筛选胶囊。纯链接，筛选状态全在 URL 上（能收藏、能后退）。
 *
 * 成果页的筛选区和导出页的申报年度共用这一个——同一种「换筛选」的动作，
 * 两处长得不一样就像两个东西。
 */
export function FilterChip({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
        // 手机上点击区统一 44px（CLAUDE.md）。胶囊本身只有 28px 高，成果页一屏四十多颗，
        // 真把它们撑到 44px 筛选区就比数据还高——所以用一块透明的伪元素上下各延 8px，
        // 看着不变、手指点得中（同任务勾选框「外包 label、负外边距抵掉」那一招）。桌面照旧
        "relative max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-2",
        // 未选中走中间调而不是白底加阴影：成果页筛选区有四十多个胶囊，
        // 个个浮起来时比下面的数据还重。well 让它们沉进卡片里，
        // 只有选中的那颗主色胶囊立起来
        active
          ? "bg-primary font-medium text-primary-foreground"
          : "bg-well text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
