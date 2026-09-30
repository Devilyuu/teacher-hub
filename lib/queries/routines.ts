import "server-only";
import { cache } from "react";
import { dateOnly, todayAsDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { latestDueDate } from "@/lib/recurring";
import { SELF_ASSIGNEE, todayQueueTasks } from "@/lib/tasks";

/** 任务列表要的形状。关联课题只取显示用的两个字段 */
const taskSelect = {
  id: true,
  title: true,
  source: true,
  assignee: true,
  priority: true,
  status: true,
  dueDate: true,
  note: true,
  tags: true,
  completedAt: true,
  createdAt: true,
  relatedProjectId: true,
  relatedProject: { select: { id: true, title: true, shortTitle: true } },
  sourceMeetingId: true,
} as const;

export type TaskListItem = Awaited<ReturnType<typeof getTasks>>[number];

/** 未删除的任务。回收站另走 `getTrashedTasks` */
export async function getTasks() {
  return prisma.task.findMany({
    where: { deletedAt: null },
    select: taskSelect,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
}

/**
 * 首页「今天要处理」：逾期的 + 今天到期的 + 高优先级未完成的，
 * 口径与 `lib/tasks.ts` 的 `todayQueueTasks` 完全一致（那份纯函数仍是真相，
 * 这里只是把同样的条件下沉到 SQL）。
 *
 * 原来首页调 `getTasks()` 把全表（含已完成、含课题 join）拉回来，只为裁出 8 条。
 * 现在只取前 `limit` 条 + 总数；排序在库里做（优先级枚举的声明顺序就是 HIGH 在前），
 * 取回后再过一遍 `todayQueueTasks` 保证两边永远一个口径。
 */
export async function getTodayQueueTasks(limit: number, now: Date = new Date()) {
  const today = todayAsDateOnly(now);
  const where = {
    deletedAt: null,
    status: { not: "DONE" as const },
    // 等别人的不进「今天要处理」，它们在右栏自己那张卡上（口径同 todayQueueTasks）
    assignee: { in: ["", SELF_ASSIGNEE] },
    OR: [{ dueDate: { lte: today } }, { priority: "HIGH" as const }],
  };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: taskSelect,
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { createdAt: "desc" },
      ],
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);
  return {
    shown: todayQueueTasks(rows, now),
    overflow: Math.max(0, total - rows.length),
  };
}

/**
 * 首页右栏「等别人」：没做完、负责人不是「我」的任务，按截止日排，
 * 只取前 `limit` 条 + 总数。口径同 `lib/tasks.ts` 的 `isWaitingOn`。
 * 负责人来源有三处：任务表单直接填、会议决议转任务带过来、轮派记录转任务写教师名。
 */
export async function getWaitingOnTasks(limit: number) {
  const where = {
    deletedAt: null,
    status: { not: "DONE" as const },
    NOT: { assignee: { in: ["", SELF_ASSIGNEE] } },
  };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      select: taskSelect,
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { createdAt: "desc" },
      ],
      take: limit,
    }),
    prisma.task.count({ where }),
  ]);
  return { shown: rows, overflow: Math.max(0, total - rows.length) };
}

/** 任务页头「回收站 · N」用。只要数字，不必把整批行取回来 */
export async function countTrashedTasks() {
  return prisma.task.count({ where: { deletedAt: { not: null } } });
}

export async function getTrashedTasks() {
  return prisma.task.findMany({
    where: { deletedAt: { not: null } },
    select: { ...taskSelect, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
}

/** 某个课题下的任务，课题详情页的「任务」Tab 用——这是换成外键后才做得到的反查 */
export async function getTasksForProject(projectId: string) {
  return prisma.task.findMany({
    where: { relatedProjectId: projectId, deletedAt: null },
    select: taskSelect,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  });
}

/** 新建任务时的课题下拉。归档的不列——给一个 2016 年的老课题挂待办没有意义 */
export async function getTaskProjectOptions() {
  return prisma.project.findMany({
    where: { archivedAt: null },
    select: { id: true, title: true, shortTitle: true },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getRecurringRules() {
  return prisma.recurringRule.findMany({
    select: {
      id: true,
      title: true,
      freq: true,
      day: true,
      active: true,
      source: true,
      priority: true,
      note: true,
      lastRunYmd: true,
      createdAt: true,
      relatedProject: { select: { id: true, title: true, shortTitle: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * 补生成到期的周期任务。**每次打开任务页都调**，靠 `lastRunYmd` 原子认领，
 * 两个标签页同时打开也不会重复建。
 *
 * 没有 cron 是刻意的（见 lib/recurring.ts 文件头）：单人工具不值得为此
 * 常驻一个进程，"当天第一次打开页面"就是足够好的触发点。
 */
export async function ensureRecurringTasks(now: Date = new Date()): Promise<number> {
  const rules = await prisma.recurringRule.findMany({ where: { active: true } });
  let created = 0;

  for (const rule of rules) {
    const due = latestDueDate(rule, now);
    if (!due) continue;

    await prisma.$transaction(async (tx) => {
      // 认领这一次生成：只有把 lastRunYmd 从旧值改成今天的那个请求会建任务。
      // 并发请求看到 count === 0，什么都不做
      const claimed = await tx.recurringRule.updateMany({
        where: { id: rule.id, lastRunYmd: rule.lastRunYmd },
        data: { lastRunYmd: due },
      });
      if (claimed.count === 0) return;

      const [year, month, day] = due.split("-").map(Number);
      await tx.task.create({
        data: {
          title: rule.title,
          source: rule.source,
          assignee: rule.assignee,
          priority: rule.priority,
          dueDate: dateOnly(year, month, day),
          relatedProjectId: rule.relatedProjectId,
          note: rule.note,
        },
      });
      created += 1;
    });
  }
  return created;
}

// ─── 会议 ────────────────────────────────────────────────────────────

export async function getMeetings() {
  return prisma.meeting.findMany({
    select: {
      id: true,
      title: true,
      meetingTime: true,
      type: true,
      minutes: true,
      agenda: true,
      resolutions: true,
      _count: { select: { tasks: true, agendaItems: true } },
    },
    orderBy: { meetingTime: "desc" },
  });
}

// generateMetadata 和页面各调一次；转写稿单条可上百 KB，同一请求只查一次
export const getMeetingDetail = cache(getMeetingDetailUncached);

async function getMeetingDetailUncached(id: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      meetingTime: true,
      type: true,
      agenda: true,
      minutes: true,
      resolutions: true,
      transcriptionEnabled: true,
      recordings: {
        select: {
          id: true,
          originalName: true,
          status: true,
          durationSec: true,
          transcript: true,
          draftSummary: true,
          draftDiscussion: true,
          draftResolutions: true,
          draftTasks: true,
          draftOpenIssues: true,
          expiresAt: true,
          confirmedAt: true,
          audioDeletedAt: true,
          errorCode: true,
          errorNote: true,
          cloudConsentAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      agendaItems: { select: { id: true, content: true, status: true } },
      tasks: { select: taskSelect },
    },
  });
  if (!meeting) return null;
  const now = Date.now();
  return {
    ...meeting,
    recordings: meeting.recordings.map((recording) => {
      const millisecondsUntilExpiry = recording.expiresAt
        ? recording.expiresAt.getTime() - now
        : null;
      const audioExpiryState = recording.confirmedAt || recording.audioDeletedAt || millisecondsUntilExpiry === null
        ? null
        : millisecondsUntilExpiry <= 0
          ? "expired" as const
          : millisecondsUntilExpiry <= 24 * 60 * 60_000
            ? "day-six" as const
            : null;
      return { ...recording, audioExpiryState };
    }),
  };
}

/** 议题池里还没排进任何会议的 */
export async function getPendingAgendaItems() {
  return prisma.agendaItem.findMany({
    where: { status: "PENDING" },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

// ─── 轮派 ────────────────────────────────────────────────────────────

export async function getDutyRecords() {
  return prisma.dutyRecord.findMany({
    select: {
      id: true,
      date: true,
      title: true,
      note: true,
      dutyType: { select: { id: true, name: true } },
      // 连接表改显式之后多一层 teacher（见 schema 里 DutyParticipant 的注释）。
      // **按姓名排**：隐式 m2m 时代顺序是库给什么算什么，同一条记录两次打开
      // 人名顺序可能不同，看着像数据变了
      participants: {
        select: { teacher: { select: { id: true, name: true } } },
        orderBy: { teacher: { name: "asc" } },
      },
    },
    orderBy: { date: "desc" },
  });
}

export async function getDutyTypes() {
  return prisma.dutyType.findMany({
    select: { id: true, name: true, note: true, _count: { select: { records: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getTeachers() {
  return prisma.teacher.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ─── 首页用的汇总 ────────────────────────────────────────────────────

/** 从今天起最近的几场会。首页右栏「近期会议」用 */
export async function getUpcomingMeetings(limit = 4) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return prisma.meeting.findMany({
    where: { meetingTime: { gte: startOfToday } },
    select: { id: true, title: true, meetingTime: true, type: true },
    orderBy: { meetingTime: "asc" },
    take: limit,
  });
}

/**
 * 首页顶部那几个数字。
 *
 * **本周按自然周（周一到周日）算**，不是"往后 7 天"——
 * 人在排期时想的是"这周还有什么"，跨到下周一的事不该混进来。
 */
export async function getRoutineStats(now: Date = new Date()) {
  const today = todayAsDateOnly(now);
  const dow = (today.getUTCDay() + 6) % 7; // 周一 = 0
  const weekStart = new Date(today.getTime() - dow * 86_400_000);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  // 「本周完成 N 项 / 在办 N」那两条 count 随「本周动态」卡一起去掉了（2026-09-15）：
  // 用户从不看它，右栏那一格换成了「等别人」
  const [dueToday, overdue, weekMeetings] = await Promise.all([
    prisma.task.count({
      where: { deletedAt: null, status: { not: "DONE" }, dueDate: today },
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { not: "DONE" }, dueDate: { lt: today } },
    }),
    prisma.meeting.count({ where: { meetingTime: { gte: weekStart, lt: weekEnd } } }),
  ]);

  return { dueToday, overdue, weekMeetings };
}
