import Link from "next/link";
import {
  Activity,
  CalendarDays,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import { DecorTile, type DecorDomain } from "@/components/decor-tile";
import { ClearCalendarArt } from "@/components/empty-art";
import { formatDaysLeft } from "@/lib/format";
import { MEETING_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { MeetingType } from "@/lib/generated/prisma/enums";

export type UpcomingMeeting = {
  id: string;
  title: string;
  type: MeetingType;
  /** 服务端格式化好，客户端不重复一套时区逻辑 */
  timeText: string;
};

export type DeadlineItem = {
  id: string;
  name: string;
  daysLeft: number | null;
  hint: string;
  /** 跳哪去。**必须由调用方给**——这张卡现在同时装课题截止和参赛报名截止，
   *  原来写死的 `/projects/${id}` 会把参赛记录跳成一个 404 的课题 */
  href: string;
};

/** 右栏的卡片外壳。四块结构一致：图标圆片 + 标题 + 右上角入口 + 内容。
 *  本周课表（components/week-timetable.tsx）也用它，所以导出 */
export function SideCard({
  title,
  icon,
  domain,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  icon: LucideIcon;
  /** 图标片的装饰色按功能域取（components/decor-tile.tsx），不按位置随手配 */
  domain: DecorDomain;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <DecorTile icon={icon} domain={domain} />
        <h2 className="text-base font-semibold">{title}</h2>
        {actionHref ? (
          <Link
            href={actionHref}
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {actionLabel} →
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function UpcomingMeetings({
  meetings,
}: {
  meetings: UpcomingMeeting[];
}) {
  return (
    <SideCard
      title="近期会议"
      icon={CalendarDays}
      domain="meeting"
      actionHref="/meetings"
      actionLabel="会议"
    >
      {meetings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-well px-4 py-5">
          <ClearCalendarArt className="size-11 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">近期没有排会</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <Link
                href={`/meetings/${meeting.id}`}
                className="block text-sm underline-offset-4 hover:underline"
              >
                {meeting.title}
              </Link>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded border px-1.5 py-0.5">
                  {MEETING_TYPE_LABELS[meeting.type]}
                </span>
                <span className="tabular-nums">{meeting.timeText}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </SideCard>
  );
}

export function WeeklyDigest({
  doneThisWeek,
  openTasks,
}: {
  doneThisWeek: number;
  openTasks: number;
}) {
  const total = doneThisWeek + openTasks;
  const rate = total > 0 ? doneThisWeek / total : 0;

  return (
    <SideCard title="本周动态" icon={Activity} domain="task">
      <p className="text-sm">
        本周完成{" "}
        <span className="font-medium tabular-nums">{doneThisWeek}</span> 项任务
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>在办</span>
          <span className="tabular-nums">{openTasks}</span>
        </div>
        {/* 进度条用中性色。**不碰健康度那六个语义色**（CLAUDE.md 视觉语言） */}
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/40"
            style={{ width: `${Math.round(rate * 100)}%` }}
          />
        </div>
      </div>
    </SideCard>
  );
}

/** 时间轴的量程。和首页「90 天内到期」那张数字卡同一口径，两处别改岔了 */
const AXIS_DAYS = 90;

/**
 * 倒计时的时间刻度：未来 90 天的横轴，节点按剩余天数落位。
 * 它给的是**分布的形状**（一眼看出「一个火烧眉毛、三个挤在下月」），
 * 逐条信息仍在下面的列表里——轴是插图不是控件，所以整块 aria-hidden。
 *
 * 已逾期的钉在「今天」，超出量程的钉在右端画成空心；
 * 挨得太近的相邻节点抬到上层车道，免得叠成一坨。
 */
function DeadlineAxis({ items }: { items: DeadlineItem[] }) {
  type AxisDot = {
    id: string;
    pct: number;
    lifted: boolean;
    urgent: boolean;
    beyond: boolean;
  };
  // 平铺的 for 而不是 map：车道判定依赖前一个点，
  // 在 map 回调里改闭包变量会被 react-hooks/immutability 拦下
  const dots: AxisDot[] = [];
  for (const item of items) {
    if (item.daysLeft == null) continue;
    const days = item.daysLeft;
    const pct = (Math.min(Math.max(days, 0), AXIS_DAYS) / AXIS_DAYS) * 100;
    const previous = dots.at(-1);
    dots.push({
      id: item.id,
      pct,
      lifted: previous != null && pct - previous.pct < 7 && !previous.lifted,
      urgent: days <= 30,
      beyond: days > AXIS_DAYS,
    });
  }

  if (dots.length === 0) return null;

  return (
    <div aria-hidden className="relative h-10">
      <div className="absolute inset-x-0 bottom-3.5 h-px bg-border" />
      {[0, 1, 2, 3].map((tick) => (
        <span
          key={tick}
          className="absolute bottom-2.5 w-px bg-border"
          style={{ left: `${(tick / 3) * 100}%`, height: "0.25rem" }}
        />
      ))}
      <span className="absolute bottom-0 left-0 text-[10px] leading-none text-muted-foreground">
        今天
      </span>
      <span className="absolute bottom-0 left-1/3 -translate-x-1/2 text-[10px] leading-none text-muted-foreground">
        30
      </span>
      <span className="absolute bottom-0 left-2/3 -translate-x-1/2 text-[10px] leading-none text-muted-foreground">
        60
      </span>
      <span className="absolute right-0 bottom-0 text-[10px] leading-none text-muted-foreground">
        90 天
      </span>
      {dots.map((dot) => (
        <span
          key={dot.id}
          className={cn(
            "absolute size-2 -translate-x-1/2 rounded-full",
            // 琥珀沿用本卡「剩余 ≤30 天」文字和数字卡警示点的既有用色，不是新开的装饰色
            dot.beyond
              ? "border border-muted-foreground/70"
              : dot.urgent
                ? "bg-[var(--h-amber)]"
                : "bg-foreground/45",
          )}
          style={{
            left: `${dot.pct}%`,
            bottom: dot.lifted ? "1.625rem" : "0.625rem",
          }}
        />
      ))}
    </div>
  );
}

/**
 * 重要节点倒计时。**这是本平台版的「重要节点」**——
 * 参考稿那边是任务的截止日，这边最要紧的是课题的结题截止：
 * 一个课题错过结题期，前两年的活儿就白干了。
 */
export function DeadlineCountdown({ items }: { items: DeadlineItem[] }) {
  return (
    <SideCard
      title="重要节点倒计时"
      icon={Hourglass}
      domain="project"
      actionHref="/projects"
      actionLabel="课题"
    >
      {items.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          给课题填上结题或申报截止日、给参赛填上报名截止，就会出现在这里。
        </p>
      ) : (
        <>
          <DeadlineAxis items={items} />
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-baseline gap-2">
                <Link
                  href={item.href}
                  className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
                  title={item.name}
                >
                  {item.name}
                </Link>
                <span
                  className={
                    item.daysLeft != null && item.daysLeft <= 30
                      ? "shrink-0 text-xs tabular-nums text-[var(--h-amber-fg)]"
                      : "shrink-0 text-xs tabular-nums text-muted-foreground"
                  }
                >
                  {formatDaysLeft(item.daysLeft)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SideCard>
  );
}
