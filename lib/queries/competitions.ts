import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * 指导参赛模块的读取层。页面只消费这里的结果，不各自拼 include——
 * 「参赛记录怎么排、队员按什么顺序列」这类口径只在一处定。
 */

/** 赛事字典。下拉框按「用得多的在前」排，不按字母 */
export function getCompetitions() {
  return prisma.competition.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      organizer: true,
      level: true,
      note: true,
      _count: { select: { entries: true } },
    },
  });
}

const entryListSelect = {
  id: true,
  year: true,
  track: true,
  editionText: true,
  level: true,
  status: true,
  registerDeadline: true,
  competeAt: true,
  competeDateText: true,
  competeDatePrecision: true,
  award: true,
  awardTitle: true,
  awardedAt: true,
  awardDateText: true,
  awardDatePrecision: true,
  myOrder: true,
  note: true,
  achievementId: true,
  competition: { select: { id: true, name: true } },
  members: {
    orderBy: [{ orderIndex: "asc" as const }],
    select: { id: true, name: true, note: true, studentId: true },
  },
  coaches: {
    orderBy: [{ orderIndex: "asc" as const }],
    select: { id: true, orderIndex: true, teacher: { select: { id: true, name: true } } },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.CompetitionEntrySelect;

/**
 * 参赛记录列表。
 *
 * **按年度倒序、同年按报名截止升序**：同一年里最急的排前面，
 * 没填截止日的（nulls）排后面——`sortOrder: "last"` 不能省，
 * Postgres 默认 DESC 时 NULL 在前，会把「还没定日期」的顶到最上面。
 */
export function getCompetitionEntries(filters: {
  year?: number;
  competitionId?: string;
} = {}) {
  return prisma.competitionEntry.findMany({
    where: {
      ...(filters.year != null ? { year: filters.year } : {}),
      ...(filters.competitionId ? { competitionId: filters.competitionId } : {}),
    },
    orderBy: [
      { year: "desc" },
      { registerDeadline: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    select: entryListSelect,
  });
}

export type CompetitionEntryRow = Awaited<
  ReturnType<typeof getCompetitionEntries>
>[number];

export function getCompetitionEntry(id: string) {
  return prisma.competitionEntry.findUnique({
    where: { id },
    select: {
      ...entryListSelect,
      createdAt: true,
      updatedAt: true,
      competition: {
        select: { id: true, name: true, organizer: true, level: true },
      },
      achievement: { select: { id: true, title: true } },
      members: {
        orderBy: [{ orderIndex: "asc" as const }],
        select: {
          id: true,
          name: true,
          note: true,
          studentId: true,
          student: { select: { id: true, name: true, classGroup: { select: { name: true } } } },
        },
      },
      attachments: {
        orderBy: [{ uploadedAt: "desc" as const }],
        select: {
          id: true,
          kind: true,
          code: true,
          filename: true,
          size: true,
          mimeType: true,
          note: true,
          uploadedAt: true,
        },
      },
    },
  });
}

export type CompetitionEntryDetail = NonNullable<
  Awaited<ReturnType<typeof getCompetitionEntry>>
>;

/**
 * 首页倒计时和月历要的最小字段集。
 *
 * **只取还可能有节点的记录**：已放弃的不要，出了结果的也不要报名截止
 * （过滤在 lib/competitions.ts 的纯函数里做，这里只管别把整库拉出来）。
 */
export function getCompetitionDeadlineSource() {
  return prisma.competitionEntry.findMany({
    where: { OR: [{ registerDeadline: { not: null } }, { competeAt: { not: null } }] },
    select: {
      id: true,
      year: true,
      track: true,
      level: true,
      status: true,
      award: true,
      registerDeadline: true,
      competeAt: true,
      competition: { select: { name: true } },
    },
  });
}

/** 年度筛选胶囊用。库里有哪些年度就给哪些，不预生成 */
export async function getCompetitionYears(): Promise<number[]> {
  const rows = await prisma.competitionEntry.findMany({
    distinct: ["year"],
    orderBy: { year: "desc" },
    select: { year: true },
  });
  return rows.map((row) => row.year);
}
