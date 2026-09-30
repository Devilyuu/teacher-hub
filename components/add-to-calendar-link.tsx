import { CalendarPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 「加到日历」——把一场会、一个截止日、一条任务导成 .ics 交给手机日历。
 *
 * 四处入口（会议详情、课题倒计时卡、参赛记录、任务行）共用这一个，
 * 同一个动作在不同页面得长一个样（CLAUDE.md 视觉语言）。
 * 用 `<a>` 不用 `<Link>`：目标是个文件接口，客户端路由和预取都不该碰它。
 *
 * 只在日期还没过时渲染它——调用方负责判断（`isUpcomingMeeting` / `isTodayOrLater`），
 * 过去的日期加进手机，两条提醒都已经错过了
 */
export function AddToCalendarLink({
  href,
  title,
  children,
  className,
}: {
  href: string;
  /** 悬停说明，同时是图标态的读屏文案 */
  title: string;
  /** 不传就是只有图标的正圆小按钮 */
  children?: React.ReactNode;
  className?: string;
}) {
  const iconOnly = children == null;
  return (
    <a
      href={href}
      title={title}
      aria-label={iconOnly ? title : undefined}
      className={cn(
        buttonVariants(
          iconOnly ? { variant: "ghost", size: "icon-sm" } : { variant: "outline", size: "sm" },
        ),
        iconOnly && "text-muted-foreground",
        className,
      )}
    >
      <CalendarPlus className={iconOnly ? "size-3.5" : undefined} aria-hidden />
      {children}
    </a>
  );
}
