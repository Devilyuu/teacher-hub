import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { todayAsDateOnly } from "@/lib/date";
import type { AgendaEntry, DayAgenda } from "@/lib/day-agenda";
import { getDayAgenda } from "@/lib/queries/day-agenda";
import { getSemesters } from "@/lib/queries/semesters";
import { semesterStatus } from "@/lib/semester";
import { cn } from "@/lib/utils";

/**
 * 首页问候带。全页唯一「对人说话」的地方——首页没有 .page-title。
 *
 * 2026-09-13 从一行问候改成带子（样张挑过三套文字，用户定了「今天的时间安排」）：
 *
 * - **第二行只回答「今天哪几段走不开」**：课和会，按半天排。
 *   它和下面的数字卡、列表分工——那些在数「有几件事」，这里说「时间被谁占着」，
 *   **不许往这一行塞数字卡已经在数的东西**（样张里试过「这周 4 个会」，
 *   和「本周会议 2」的卡同屏打架）。口径在 lib/day-agenda.ts
 * - **仪表环水印只露上半**：开口朝上的缺口和轴心点都在可见区里，才认得出是品牌标记；
 *   整个露出来是个普通圆圈，裁成一小块是个色斑。跟 currentColor 走、不上色
 *
 * 时间口径依赖**进程时区 = 用户所在时区**（部署铁律，TZ=Asia/Shanghai），
 * 页面本身 force-dynamic，不会被烘成构建那一刻的问候。
 * 「第 N 教学周」由设置页的学期锚点推算（lib/semester.ts）；
 * 没设学期就只显示日期，不猜。
 */
export async function HomeGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 5
      ? "夜深了"
      : hour < 11
        ? "早上好"
        : hour < 13
          ? "中午好"
          : hour < 18
            ? "下午好"
            : "晚上好";
  const dateText = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);

  const semesters = await getSemesters();
  const agenda = await getDayAgenda(now, semesters);
  const status = semesterStatus(semesters, todayAsDateOnly(now));
  // 纯日期列按 UTC 取年月日（lib/date.ts 的约定），不许用本地 getMonth
  const semesterText =
    status == null
      ? null
      : status.kind === "week"
        ? `${status.name} · 第 ${status.week} 教学周`
        : `${status.name} · ${status.startDate.getUTCMonth() + 1} 月 ${status.startDate.getUTCDate()} 日开学`;

  return (
    <section className="greeting-band">
      <BrandMark className="pointer-events-none absolute -top-3.5 right-14 size-56 text-primary opacity-10 max-sm:-right-12 max-sm:size-40" />

      <div className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 2026-09-12 改版去掉衬线：衬线现在只剩登录页标题和顶栏字标两处 */}
        <h1 className="text-3xl font-extrabold tracking-[-0.025em]">{greeting}</h1>
        <p className="text-sm text-muted-foreground">
          {dateText}
          {semesterText ? ` · ${semesterText}` : null}
        </p>
      </div>

      <AgendaLine agenda={agenda} />
    </section>
  );
}

function AgendaLine({ agenda }: { agenda: DayAgenda }) {
  return (
    <div className="relative mt-3 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline">
      <span className="mr-3.5 text-[13px] font-semibold text-accent-foreground">{agenda.lead}</span>
      <AgendaParts agenda={agenda} />
    </div>
  );
}

/** 一段：灰色小标签 + 正文。扫一眼先抓到的是事，不是标签 */
function Part({ label, children, muted }: { label?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-baseline gap-2 sm:px-4 sm:first:pl-0",
        muted ? "text-muted-foreground" : "text-foreground/85",
      )}
    >
      {label ? <span className="shrink-0 text-xs text-muted-foreground">{label}</span> : null}
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Entries({ entries }: { entries: AgendaEntry[] }) {
  return entries.map((entry, index) => (
    <span key={entry.key}>
      {index > 0 ? "；" : null}
      {entry.kind === "meeting" ? (
        <Link href={`/meetings/${entry.meetingId}`} className="underline-offset-4 hover:underline">
          {entry.text}
        </Link>
      ) : (
        entry.text
      )}
    </span>
  ));
}

function AgendaParts({ agenda }: { agenda: DayAgenda }) {
  const listClass =
    "flex flex-col gap-1 text-[15px] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-y-1.5 sm:divide-x sm:divide-primary/20";

  // 课表未知：不画「上午 空着」——那等于替用户说了「没有课」
  if (agenda.timetable !== "known") {
    return (
      <ul className={listClass}>
        {agenda.meetings.length > 0 ? (
          agenda.meetings.map((entry) => (
            <Part key={entry.key}>
              <Entries entries={[entry]} />
            </Part>
          ))
        ) : (
          <Part muted>没排会</Part>
        )}
        {agenda.timetable === "not-imported" ? (
          <Part muted>
            <Link href="/settings/timetable" className="underline underline-offset-4 hover:text-foreground">
              导入课表
            </Link>
            后，这里会一起显示当天的课
          </Part>
        ) : null}
      </ul>
    );
  }

  const isFree = agenda.halfDays.every((cell) => cell.entries.length === 0);
  if (isFree) {
    return (
      <ul className={listClass}>
        <Part>没有课，也没排会</Part>
        {agenda.nextClass ? <Part label="下一节课">{agenda.nextClass}</Part> : null}
      </ul>
    );
  }

  return (
    <ul className={listClass}>
      {agenda.halfDays.map((cell) =>
        cell.entries.length === 0 ? (
          <Part key={cell.halfDay} label={cell.label} muted>
            空着
          </Part>
        ) : (
          <Part key={cell.halfDay} label={cell.label}>
            <Entries entries={cell.entries} />
          </Part>
        ),
      )}
    </ul>
  );
}
