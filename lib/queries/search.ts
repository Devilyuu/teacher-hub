import "server-only";
import { entryTitle } from "@/lib/competitions";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { formatTimestamp } from "@/lib/format";
import {
  ACHIEVEMENT_TYPE_LABELS,
  COMPETITION_AWARD_LABELS,
  LEVEL_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/labels";
import type { ModuleVisibility } from "@/lib/modules";

/**
 * 平台级全局搜索（prd-routines 4）。
 *
 * 原 dept-cockpit 只搜任务和会议，合并后要跨课题、成果、任务、会议、轮派——
 * 「我记得有这么件事，但不记得它在哪个模块」正是合并之后最容易发生的情况。
 *
 * 实现上是**六条并行的 ILIKE 查询**，不是全文索引：单人使用的数据量
 * （几百条成果、几十个课题）下 `contains` 完全够用，而全文索引要维护
 * 分词配置和触发器，对这个规模是纯负担。数据涨到几万条再说。
 */

/** 一条搜索结果。八种来源共用一个形状，界面按 kind 分组 */
export type SearchHit = {
  kind:
    | "project"
    | "achievement"
    | "task"
    | "meeting"
    | "duty"
    | "document"
    | "student"
    | "honor"
    | "competition";
  id: string;
  title: string;
  /** 副标题：级别、年度、日期这类能帮人认出是哪一条的信息 */
  meta: string;
  href: string;
};

export type SearchResults = {
  query: string;
  hits: SearchHit[];
  /** 按来源分组的条数，界面上显示「课题 3 · 成果 12」 */
  counts: Record<SearchHit["kind"], number>;
};

/** 每类最多返回这么多。搜索是"帮你找到那一条"，不是列清单 */
const PER_KIND = 8;

/**
 * `modules` 决定哪些来源参与搜索——被关闭模块的记录不该出现在结果里，
 * 「导航上没有、搜索却搜得到」是模块开关最容易漏的裂缝。
 */
export async function search(
  rawQuery: string,
  modules: ModuleVisibility,
): Promise<SearchResults> {
  const query = rawQuery.trim();
  const empty: SearchResults = {
    query,
    hits: [],
    counts: {
      project: 0,
      achievement: 0,
      task: 0,
      meeting: 0,
      duty: 0,
      document: 0,
      student: 0,
      honor: 0,
      competition: 0,
    },
  };
  // 一个字也能搜——中文里单字就是有效关键词（「奖」「专利」）
  if (query.length === 0) return empty;

  const like = { contains: query, mode: "insensitive" as const };

  const [
    projects,
    achievements,
    tasks,
    meetings,
    duties,
    documents,
    students,
    honors,
    competitionEntries,
  ] = await Promise.all([
    prisma.project.findMany({
      where: { OR: [{ title: like }, { shortTitle: like }, { code: like }, { note: like }] },
      select: { id: true, title: true, shortTitle: true, code: true, status: true, level: true },
      take: PER_KIND,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.achievement.findMany({
      where: {
        archivedAt: null,
        OR: [{ title: like }, { journalName: like }, { note: like }, { tags: { has: query } }],
      },
      select: { id: true, title: true, type: true, year: true, level: true },
      take: PER_KIND,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.task.findMany({
      where: { deletedAt: null, OR: [{ title: like }, { note: like }, { tags: { has: query } }] },
      select: { id: true, title: true, status: true, dueDate: true },
      take: PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.meeting.findMany({
      // 纪要正文也搜——「上次开会说的那件事」多半只在纪要里
      where: { OR: [{ title: like }, { minutes: like }] },
      select: { id: true, title: true, meetingTime: true },
      take: PER_KIND,
      orderBy: { meetingTime: "desc" },
    }),
    modules.duties
      ? prisma.dutyRecord.findMany({
          where: { OR: [{ title: like }, { note: like }] },
          select: { id: true, title: true, date: true, dutyType: { select: { name: true } } },
          take: PER_KIND,
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
    prisma.attachment.findMany({
      where: {
        projectId: null,
        achievementId: null,
        docCategoryId: { not: null },
        OR: [{ filename: like }, { note: like }],
      },
      select: {
        id: true,
        filename: true,
        docCategory: { select: { name: true } },
      },
      take: PER_KIND,
      orderBy: { uploadedAt: "desc" },
    }),
    // 班主任模块。电话号码也在搜索范围里——「这个没存的号码是谁家长」是真场景
    modules.advisor
      ? prisma.student.findMany({
          where: {
            OR: [
              { name: like },
              { studentNo: like },
              { phone: like },
              { parentPhone: like },
              { dormRoom: like },
              { note: like },
            ],
          },
          select: {
            id: true,
            name: true,
            dormRoom: true,
            active: true,
            classGroup: { select: { name: true } },
          },
          take: PER_KIND,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    modules.advisor
      ? prisma.studentHonor.findMany({
          where: { OR: [{ title: like }, { issuer: like }, { note: like }] },
          select: { id: true, title: true, level: true },
          take: PER_KIND,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    // 指导参赛。**队员姓名也搜**——「那年带小王打的那个比赛」是真场景，
    // 而记得住的往往是人不是赛事全称
    modules.competitions
      ? prisma.competitionEntry.findMany({
          where: {
            OR: [
              { competition: { name: like } },
              { track: like },
              { awardTitle: like },
              { note: like },
              { members: { some: { name: like } } },
            ],
          },
          select: {
            id: true,
            year: true,
            track: true,
            level: true,
            awardTitle: true,
            award: true,
            competition: { select: { name: true } },
          },
          take: PER_KIND,
          orderBy: [{ year: "desc" }, { updatedAt: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  // Prisma 的 to-one 关系类型仍允许 null；分类缺失时宁可不返回，也不能把异常附件
  // 当成个人文档交给界面下载。
  const documentHits: SearchHit[] = documents.flatMap((row) =>
    row.docCategory
      ? [
          {
            kind: "document",
            id: row.id,
            title: row.filename,
            meta: row.docCategory.name,
            href: `/api/attachments/${row.id}?download=1`,
          },
        ]
      : [],
  );

  return {
    query,
    hits: [
      // meta 一律走 lib/labels.ts 转中文——**界面文案全中文**（代码约定），
      // 直接把枚举值塞进去会在搜索结果里冒出 ONGOING、PAPER 这种
      ...projects.map(
        (row): SearchHit => ({
          kind: "project",
          id: row.id,
          title: row.shortTitle ?? row.title,
          meta: [row.code, LEVEL_LABELS[row.level], PROJECT_STATUS_LABELS[row.status]]
            .filter(Boolean)
            .join(" · "),
          href: `/projects/${row.id}`,
        }),
      ),
      ...achievements.map(
        (row): SearchHit => ({
          kind: "achievement",
          id: row.id,
          title: row.title,
          meta: [
            row.year ? `${row.year} 年` : null,
            ACHIEVEMENT_TYPE_LABELS[row.type],
            LEVEL_LABELS[row.level],
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/achievements/${row.id}`,
        }),
      ),
      ...tasks.map(
        (row): SearchHit => ({
          kind: "task",
          id: row.id,
          title: row.title,
          meta: [
            TASK_STATUS_LABELS[row.status],
            row.dueDate ? `${formatDateOnly(row.dueDate)} 截止` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: "/tasks",
        }),
      ),
      ...meetings.map(
        (row): SearchHit => ({
          kind: "meeting",
          id: row.id,
          title: row.title,
          meta: formatTimestamp(row.meetingTime),
          href: `/meetings/${row.id}`,
        }),
      ),
      ...duties.map(
        (row): SearchHit => ({
          kind: "duty",
          id: row.id,
          title: row.title,
          meta: `${row.dutyType.name} · ${formatDateOnly(row.date)}`,
          href: "/duties",
        }),
      ),
      ...documentHits,
      ...students.map(
        (row): SearchHit => ({
          kind: "student",
          id: row.id,
          title: row.name,
          meta: [
            row.classGroup.name,
            row.dormRoom ? `宿舍 ${row.dormRoom}` : null,
            row.active ? null : "已离班",
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/students/${row.id}`,
        }),
      ),
      ...honors.map(
        (row): SearchHit => ({
          kind: "honor",
          id: row.id,
          title: row.title,
          meta: LEVEL_LABELS[row.level],
          href: `/students/honors/${row.id}`,
        }),
      ),
      ...competitionEntries.map(
        (row): SearchHit => ({
          kind: "competition",
          id: row.id,
          title: entryTitle({
            year: row.year,
            competitionName: row.competition.name,
            track: row.track,
            level: row.level,
          }),
          meta: [
            LEVEL_LABELS[row.level],
            row.awardTitle ??
              (row.award ? COMPETITION_AWARD_LABELS[row.award] : null),
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/competitions/${row.id}`,
        }),
      ),
    ],
    counts: {
      project: projects.length,
      achievement: achievements.length,
      task: tasks.length,
      meeting: meetings.length,
      duty: duties.length,
      document: documentHits.length,
      student: students.length,
      honor: honors.length,
      competition: competitionEntries.length,
    },
  };
}
