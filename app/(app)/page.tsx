import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Compass,
  FlaskConical,
  Plus,
  type LucideIcon,
} from "lucide-react";
import {
  DECOR_DOMAIN_TONES,
  DecorTile,
  type DecorDomain,
} from "@/components/decor-tile";
import {
  ClipboardArt,
  CompassArt,
  FolderCheckArt,
} from "@/components/empty-art";
import { compareByHealth } from "@/components/health";
import { HomeGreeting } from "@/components/home-greeting";
import {
  DeadlineCountdown,
  UpcomingMeetings,
  WeeklyDigest,
  type DeadlineItem,
} from "@/components/home-side";
import { CaptureInbox } from "@/components/capture-inbox";
import { TodayQueue } from "@/components/today-queue";
import { WeekTimetable } from "@/components/week-timetable";
import { MinutesQueue } from "@/components/minutes-queue";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import {
  getBoardStats,
  getProjectSummaries,
  isArchivedProject,
  type ProjectSummary,
} from "@/lib/queries/projects";
import {
  ensureRecurringTasks,
  getRoutineStats,
  getTasks,
  getUpcomingMeetings,
} from "@/lib/queries/routines";
import { capForHome } from "@/lib/capture";
import {
  DEADLINE_KIND_LABELS,
  upcomingCompetitionDeadlines,
} from "@/lib/competitions";
import { getCompetitionDeadlineSource } from "@/lib/queries/competitions";
import { emphasizedStat } from "@/lib/home-stats";
import { getEnabledModules } from "@/lib/module-settings";
import { prisma } from "@/lib/db";
import { getPendingCaptures } from "@/lib/queries/captures";
import { getRecordTypes, resolveClassGroup } from "@/lib/queries/students";
import { getMinutesHomeQueueWithRuntime } from "@/lib/queries/minutes";
import { getHomeTimetable } from "@/lib/queries/timetable";
import { todayQueueTasks } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/generated/prisma/enums";

// 缺口依赖"今天"，不能预渲染成静态页
export const dynamic = "force-dynamic";

/**
 * 看板的分列（PRD 4.1）。
 * 只有这三列参与并排——「已结束」不是流程的第四阶段而是归档，
 * 让它占四分之一宽度会把在研的卡片挤瘦，所以放到底部整条折叠。
 */
const COLUMNS: Array<{
  title: string;
  statuses: ProjectStatus[];
  /** 空列说明：**这一列装什么、东西怎么才会进来**。一句「暂无」看起来像没加载出来 */
  empty: { title: string; hint: string; art: typeof CompassArt };
}> = [
  {
    title: "申报中",
    statuses: ["DRAFT", "APPLYING"],
    empty: {
      title: "没有在申报的课题",
      hint: "状态为「拟申报」「申报中」的课题会出现在这里",
      art: ClipboardArt,
    },
  },
  {
    title: "在研",
    statuses: ["ONGOING"],
    empty: {
      title: "没有在研的课题",
      hint: "立项后把状态改为「在研」就会出现在这里",
      art: CompassArt,
    },
  },
  {
    title: "结题准备",
    statuses: ["CLOSING"],
    empty: {
      title: "还没有进入结题准备的课题",
      hint: "课题状态改为「结题准备」后会出现在这里",
      art: FolderCheckArt,
    },
  },
];

/**
 * 首页 = 工作台。
 *
 * **上半是今天要动的，下半是全局状态。** 早上打开先看"有什么事等着我"，
 * 而不是"我一共有多少课题"——后者是每周看一次的东西，放下面。
 *
 * 三段：
 *   1. 四个数字：今日到期 / 逾期 / 本周会议 / 临近截止
 *   2. 左右两栏：左边收件箱（能被处理掉的事），右边会议、动态、倒计时
 *   3. 课题罗盘：三列看板 + 归档折叠
 */
export default async function HomePage() {
  // 已归档的历史课题也取回来：它们只进底部折叠区，
  // 不占看板视线，但也不能凭空消失（PRD 4.1）
  const all = await getProjectSummaries({ includeArchived: true });
  const active = all.filter((project) => project.archivedAt == null);

  // 首页也补生成周期任务：多数日子里这是当天打开的第一个页面
  await ensureRecurringTasks();

  const [
    stats,
    routine,
    tasks,
    meetings,
    captures,
    minutesQueue,
    modules,
    timetable,
  ] = await Promise.all([
    getBoardStats(active),
    getRoutineStats(),
    getTasks(),
    getUpcomingMeetings(),
    getPendingCaptures(),
    getMinutesHomeQueueWithRuntime(),
    getEnabledModules(),
    getHomeTimetable(),
  ]);

  // 班主任模块开着时，收件箱多一个「归到学生」去向。
  // 默认班取第一个未归档的——速记归类是快动作，不在收件箱里选班
  const advisorContext = modules.advisor
    ? await (async () => {
        const classGroup = await resolveClassGroup(undefined);
        if (!classGroup) return null;
        const [students, types] = await Promise.all([
          prisma.student.findMany({
            where: { classGroupId: classGroup.id, active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          }),
          getRecordTypes(),
        ]);
        if (types.length === 0) return null;
        return {
          classGroupId: classGroup.id,
          students,
          types: types.map((type) => ({ id: type.id, name: type.name })),
        };
      })()
    : null;
  // 和收件箱同一条上限（CLAUDE.md：首页每块上限 8 条，超出显示「还有 N 条」）。
  // todayQueueTasks 已按截止日升序排好，裁掉的是最不紧急的那截
  const todayQueue = capForHome(todayQueueTasks(tasks));

  // 实心那张跟着紧急度走，不钉死在第一格（lib/home-stats.ts）
  const emphasized = emphasizedStat({
    dueToday: routine.dueToday,
    overdue: routine.overdue,
    weekMeetings: routine.weekMeetings,
    dueSoon: stats.dueSoonCount,
  });

  // 收件箱按首页上限截断（规格 §7.2）。超出的不丢，只是不铺在首页上
  const inbox = capForHome(captures);

  // 临近的截止日。**只取排在最前的几个**——倒计时是提醒不是清单，
  // 列满 20 条就没人看了。
  //
  // 过滤用 `isArchivedProject` 而不是 `archivedAt == null`：已结题但忘了点归档的
  // 课题也不该出现在倒计时里——它的截止日早过了，显示「已逾期 49 天」是纯噪音
  //
  // 参赛的报名截止和比赛日期一起排进来：它们和结题截止是同一类东西——
  // 错过就没了，而且**没有任何补救动作**。两边混排按剩余天数取最近的四条，
  // 分不清哪条是哪类的话，标题前缀（报名截止·/ 比赛·）会说清楚
  const competitionDeadlines = modules.competitions
    ? upcomingCompetitionDeadlines(
        (await getCompetitionDeadlineSource()).map((entry) => ({
          id: entry.id,
          year: entry.year,
          track: entry.track,
          level: entry.level,
          competitionName: entry.competition.name,
          status: entry.status,
          award: entry.award,
          registerDeadline: entry.registerDeadline,
          competeAt: entry.competeAt,
        })),
      )
    : [];

  const deadlines: DeadlineItem[] = [
    ...all
      .filter(
        (project) =>
          !isArchivedProject(project) && project.gap.displayDaysLeft != null,
      )
      .map((project) => ({
        id: project.id,
        name: project.shortTitle ?? project.title,
        daysLeft: project.gap.displayDaysLeft,
        hint: "",
        href: `/projects/${project.id}`,
      })),
    ...competitionDeadlines.map((item) => ({
      id: `${item.kind}-${item.entryId}`,
      name: `${DEADLINE_KIND_LABELS[item.kind]}·${item.title}`,
      daysLeft: item.daysLeft,
      hint: "",
      href: `/competitions/${item.entryId}`,
    })),
  ]
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <HomeGreeting />

      {/* `grid-cols-1` 不是多余的。Tailwind 的 `grid` 只设 display:grid，
          单列时 grid-template-columns 是 none，而 grid item 默认 min-width:auto
          会按内容撑开——手机上这些卡片会把整个页面顶宽到 465px 横滚。
          `grid-cols-1` 生成 repeat(1, minmax(0,1fr))，明确允许收缩到 0。 */}
      {/* 第一格叫「今日到期」不叫「今日待办」：它统计的是 dueDate 正好是今天的
          任务，而下面那块「今天要处理」还含逾期和高优先级。两个数字本来就不等
          （今天是 0 和 4），叫「待办」会让人以为其中一个算错了。

          **手机上是 2×2 不是竖着堆四张。** 原来 `grid-cols-1` 让四张卡在
          390px 宽的屏上各占 180px 高，一整屏手机只显示四个数字，
          得往下滚才看得见今天要处理什么——而这页存在的理由就是那个列表 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="今日到期"
          value={routine.dueToday}
          href="/tasks"
          icon={Clock}
          domain="task"
          emphasis={emphasized === "dueToday"}
        />
        <StatCard
          label="逾期"
          value={routine.overdue}
          href="/tasks"
          icon={AlertTriangle}
          domain="task"
          emphasis={emphasized === "overdue"}
        />
        <StatCard
          label="本周会议"
          value={routine.weekMeetings}
          href="/meetings"
          icon={CalendarDays}
          domain="meeting"
        />
        <StatCard
          label="90 天内到期"
          value={stats.dueSoonCount}
          href="/projects"
          icon={FlaskConical}
          domain="project"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* 「今天要处理」**只放能被处理掉的事**（PRD 第 2 节）：逾期、今天到期、
              高优先级。完整列表在 /tasks，这条边界不守住两个页面会长成一样 */}
          <TodayQueue tasks={todayQueue.shown} overflow={todayQueue.overflow} />

          {/* 规格 §7.2：待确认纪要紧跟今日任务，并先于其他工作队列。 */}
          <MinutesQueue queue={minutesQueue} />

          <CaptureInbox
            items={inbox.shown}
            overflow={inbox.overflow}
            advisor={advisorContext}
          />

          {/* 本周课表放左栏最底：它是状态不是待办，排在能被处理掉的事后面；
              放右栏会把右栏拉到左栏三倍高，左栏下面空一大片。
              学期没到显示窗口（假期）整张卡不画 */}
          {timetable ? <WeekTimetable data={timetable} /> : null}
        </div>

        <div className="space-y-4">
          <UpcomingMeetings
            meetings={meetings.map((meeting) => ({
              id: meeting.id,
              title: meeting.title,
              type: meeting.type,
              timeText: formatTimestamp(meeting.meetingTime),
            }))}
          />
          <WeeklyDigest
            doneThisWeek={routine.doneThisWeek}
            openTasks={routine.openTasks}
          />
          <DeadlineCountdown items={deadlines} />
        </div>
      </div>

      {/* ── 下半：课题罗盘 ── */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <span className="flex items-center gap-2.5">
            <DecorTile icon={Compass} domain="project" />
            <h2 className="text-lg font-bold tracking-tight">课题罗盘</h2>
          </span>
          {/* 只显示课题自己的数。**「在途成果」不放这里**——它是成果库的指标，
              而且当前口径下会骗人：导入的成果 status 一律是默认的 PLANNED，
              73 条里 69 条被算成"在途"，其实早就落地了 */}
          <p className="text-sm text-muted-foreground">
            在研 <span className="tabular-nums">{stats.activeCount}</span>
            {stats.withGapCount > 0 ? (
              <>
                {" · "}存在缺口{" "}
                <span className="tabular-nums">{stats.withGapCount}</span>
              </>
            ) : null}
          </p>
          <Link
            href="/projects"
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            课题台账 →
          </Link>
        </div>

        {all.length === 0 ? (
          <EmptyBoard />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {COLUMNS.map((column) => (
                <BoardColumn
                  key={column.title}
                  title={column.title}
                  empty={column.empty}
                  // 归档的一律不进这三列——一个 2016 年归档的在研课题
                  // 不该出现在「在研」里
                  projects={sortForBoard(
                    active.filter((p) => column.statuses.includes(p.status)),
                  )}
                />
              ))}
            </div>

            {/* 两栏分开：历史课题是做过的，未获立项的是没做成的。
                混在一起翻历史时得逐条看状态才知道哪些真的做过 */}
            <ArchivedShelf
              title="已归档的历史课题"
              projects={sortForBoard(
                all.filter(
                  (p) => isArchivedProject(p) && p.status !== "REJECTED",
                ),
              )}
            />
            <ArchivedShelf
              title="未获立项"
              hint="申报了没中，绩效只算基本分"
              projects={sortForBoard(
                all.filter((p) => p.status === "REJECTED"),
              )}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** RED 置顶（PRD 4.1），同色按标题稳定排序，免得每次刷新顺序都在跳 */
function sortForBoard(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort(
    (a, b) =>
      compareByHealth(a.gap.health, b.gap.health) ||
      (a.shortTitle ?? a.title).localeCompare(b.shortTitle ?? b.title, "zh-CN"),
  );
}

/**
 * 顶部数字卡。
 *
 * **是纯数字不是环形图**：这四个指标（今日到期、逾期、本周会议、临近到期）
 * 都**没有分母**，环全部画满就是四个装饰圈，不承载信息。
 * 有分母的那两个（缺口占比、完成度）在课题罗盘那一段里。
 *
 * **哪张实心由 `emphasizedStat` 决定，不是固定第一张**——强调要跟着紧急度走，
 * 否则会出现「今日到期 0」被涂成全屏最重、而旁边真有逾期的那张是平白卡。
 *
 * 2026-09-12 改版换了两处：
 *
 * - 加了**装饰图标圆片**（.ico-tile + --decor-*）。它是纯装饰，和健康度的
 *   语义色分属两层——形态锁死：淡底 + 线性图标，永不实心、永不带文字标签。
 *   改版前这里挂的是个 `bg-amber-500` 小圆点，那是拿语义色做装饰，
 *   看板上「琥珀 = 缺口」的意思会被稀释掉。
 * - 大数字**去掉衬线**。衬线现在只剩登录页标题和顶栏字标两处。
 */
function StatCard({
  label,
  value,
  href,
  icon: Icon,
  domain,
  emphasis,
}: {
  label: string;
  value: number;
  href: string;
  icon: LucideIcon;
  /**
   * 装饰色按功能域取（components/decor-tile.tsx），**只管好看不表状态**。
   * 「逾期」也是任务域，所以和「今日到期」同色——它原来是玫红，
   * 但玫红现在归教学域，两个域共用一色「颜色 = 哪类东西」就不成立了
   */
  domain: DecorDomain;
  emphasis?: boolean;
}) {
  const tone = DECOR_DOMAIN_TONES[domain];
  return (
    <Link
      href={href}
      className={cn(
        "surface-interactive flex flex-col gap-2 px-4 py-3.5 sm:px-5 sm:py-4",
        emphasis && "border-primary bg-primary text-primary-foreground",
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className="ico-tile"
          style={
            // 实心卡上不能再放一块彩色底片——那张卡整个是主色，
            // 淡青底片压上去就成了一块看不清的糊斑。改用同色系的半透明白
            (emphasis
              ? {
                  "--tile": "currentColor",
                  "--tile-bg": "color-mix(in srgb, currentColor 20%, transparent)",
                }
              : {
                  "--tile": `var(--decor-${tone})`,
                  "--tile-bg": `var(--decor-${tone}-bg)`,
                }) as React.CSSProperties
          }
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            emphasis ? "text-primary-foreground/85" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </span>
      <span className="text-3xl font-extrabold tabular-nums sm:text-4xl">
        {value}
      </span>
    </Link>
  );
}

/** 归档课题整条放底部，默认折叠。它是档案，不是流程的一个阶段 */
function ArchivedShelf({
  title,
  hint,
  projects,
}: {
  title: string;
  hint?: string;
  projects: ProjectSummary[];
}) {
  if (projects.length === 0) return null;

  return (
    <details className="group">
      {/* 折叠条走中间调：归档是「虚」的，白底胶囊会和看板抢视线 */}
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full bg-well px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {projects.length}
        </span>
        {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
        <span className="text-xs group-open:hidden">展开</span>
        <span className="hidden text-xs group-open:inline">收起</span>
      </summary>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </details>
  );
}

function BoardColumn({
  title,
  empty,
  projects,
}: {
  title: string;
  empty: (typeof COLUMNS)[number]["empty"];
  projects: ProjectSummary[];
}) {
  const EmptyArt = empty.art;
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
          {projects.length}
        </span>
      </h3>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-3xl bg-well px-5 py-7 text-center">
          <EmptyArt className="mb-1 size-11 text-muted-foreground/60" />
          <p className="text-sm text-foreground/80">{empty.title}</p>
          <p className="text-xs text-muted-foreground">{empty.hint}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyBoard() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-well p-14 text-center">
      <CompassArt className="size-12 text-muted-foreground/60" />
      <p className="text-muted-foreground">还没有课题。</p>
      <Button
        render={<Link href="/projects/new" />}
        nativeButton={false}
        className="rounded-full"
      >
        <Plus className="size-4" aria-hidden />
        新建课题
      </Button>
      {/* 开发命令只在 dev 里给自己看。生产空状态出现 npm run 会让界面
          看起来像没做完（空状态只给真实用户动作） */}
      {process.env.NODE_ENV === "development" ? (
        <p className="text-xs text-muted-foreground">
          或者跑{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">npm run db:seed</code>{" "}
          写入种子数据
        </p>
      ) : null}
    </div>
  );
}
