/**
 * 空状态的单色小插画。几笔线条，跟着 currentColor 走，
 * 由调用方用 text-muted-foreground 之类压淡——**不许上色**：
 * 健康度那六个语义色是留给状态的（CLAUDE.md 视觉语言），插画只是留白里的一点趣味。
 * 全部 aria-hidden：它们不承载信息，屏幕阅读器读旁边那句话就够了。
 */

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** 一杯茶：今天没有等着处理的事 */
export function TeaCupArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      {/* 杯身 + 杯把 + 茶托 */}
      <path d="M15 24h18l-1.8 9.2a4 4 0 0 1-3.9 3.3h-6.6a4 4 0 0 1-3.9-3.3z" />
      <path d="M33 26.5c2.8-.4 4.8 1 4.6 3.2-.2 2.1-2.4 3.3-4.9 2.9" />
      <path d="M12.5 41h23" />
      {/* 热气 */}
      <path d="M20.5 18.5c0-1.8 1.8-1.8 1.8-3.6s-1.8-1.8-1.8-3.6" />
      <path d="M27.5 18.5c0-1.8 1.8-1.8 1.8-3.6s-1.8-1.8-1.8-3.6" />
    </svg>
  );
}

/** 打了勾的日历：近期没有排会 */
export function ClearCalendarArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <rect x="10" y="12" width="28" height="26" rx="4" />
      <path d="M10 20h28" />
      <path d="M17 8.5v6M31 8.5v6" />
      <path d="M19.5 28.5l3.6 3.6 6.4-6.6" />
    </svg>
  );
}

/** 罗盘：还没有课题（「课题罗盘」的本尊） */
export function CompassArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <circle cx="24" cy="24" r="16" />
      <path d="M24 8v3M24 37v3M8 24h3M37 24h3" />
      {/* 指针：菱形斜指东北 */}
      <path d="M30.5 17.5l-4 9.4-9.4 4 4-9.4z" />
    </svg>
  );
}

/** 放大镜：搜索没有结果 */
export function MagnifierArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <circle cx="21" cy="21" r="11" />
      <path d="M29.5 29.5L39 39" />
      {/* 镜片上的一道高光 */}
      <path d="M15.5 18.5a6.5 6.5 0 0 1 4-4" />
    </svg>
  );
}

/** 写字板：还没有任务 / 排班记录 */
export function ClipboardArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <rect x="12" y="10" width="24" height="30" rx="4" />
      <path d="M19 10a5 5 0 0 1 10 0" />
      <path d="M18 21h12M18 27h12M18 33h7" />
    </svg>
  );
}

/** 收件托盘 + 飘进来的一页教案：还没有回流记录 */
export function InboxTrayArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      {/* 一页纸斜着往托盘里落 */}
      <g transform="rotate(8 25.5 13.5)">
        <rect x="20" y="6.5" width="11" height="13.5" rx="1.5" />
        <path d="M23 11h5M23 14.5h5" />
      </g>
      {/* 敞口托盘 */}
      <path d="M10 24v11a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V24" />
      <path d="M10 24h7.5l2.5 4h8l2.5-4H38" />
    </svg>
  );
}

/** 打了勾的文件夹：还没有进入结题准备的课题（材料齐了往里收） */
export function FolderCheckArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <path d="M8 15a3 3 0 0 1 3-3h9l4 5h13a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
      <path d="M19.5 28.5l3.2 3.2 6-6.2" />
    </svg>
  );
}

/** 文件夹：还没有归档的文档 */
export function FolderArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden {...strokeProps}>
      <path d="M8 15a3 3 0 0 1 3-3h9l4 5h13a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" />
      <path d="M8 22h32" />
    </svg>
  );
}
