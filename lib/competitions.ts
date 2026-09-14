/**
 * 指导参赛的纯计算（无 prisma、无 server-only，页面和测试共用）。
 *
 * 模块定位一句话：**参赛的价值一大半在出结果之前**——报名截止、集训、
 * 比赛日期；获奖才是成果。所以这里算的是「哪件事快到了」和「这条记录
 * 怎么称呼」，**不算「够不够格」**（第 1 条铁律：只计算，不判定）。
 */
import { diffInDays, formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { COMPETITION_AWARD_LABELS, LEVEL_LABELS } from "@/lib/labels";
import type { CompetitionAward, Level } from "@/lib/generated/prisma/enums";

export type EntryNaming = {
  year: number;
  competitionName: string;
  track: string | null;
  level: Level;
};

/**
 * 这条参赛记录怎么称呼：`2026 职业院校技能大赛 · 软件测试赛项`。
 *
 * **级别不进标题**——同一赛事的校赛/省赛/国赛各是一条记录，级别是它们的
 * 区分位，列表里已经有独立的徽章；拼进标题会让每一行都拖一条尾巴。
 */
export function entryTitle(entry: EntryNaming): string {
  const head = `${entry.year} ${entry.competitionName}`;
  return entry.track ? `${head} · ${entry.track}` : head;
}

/**
 * 「引用为成果」时的默认标题。
 *
 * 优先用奖状原文（`awardTitle`）——奖状上怎么写，台账里就该怎么写，
 * 那是评审要核对的那一行字。没有原文才按枚举拼一个。
 * **拼出来的只是默认值**，用户在草稿确认界面上可以改（第 5 条铁律）。
 */
export function achievementTitleFor(
  entry: EntryNaming & { award: CompetitionAward | null; awardTitle: string | null },
): string {
  if (entry.awardTitle) return `指导学生获${entry.awardTitle}`;
  const award =
    entry.award && entry.award !== "NONE" ? COMPETITION_AWARD_LABELS[entry.award] : "";
  const body = entry.track
    ? `${entry.competitionName}${entry.track}`
    : entry.competitionName;
  return `指导学生参加${entry.year}年${LEVEL_LABELS[entry.level]}${body}${award}`;
}

/** 首页倒计时 / 月历用的一件事 */
export type CompetitionDeadline = {
  entryId: string;
  /** 报名截止和比赛日期是两件事，会各出一条 */
  kind: "register" | "compete";
  title: string;
  /** YYYY-MM-DD */
  date: string;
  daysLeft: number;
};

type DeadlineSource = EntryNaming & {
  id: string;
  registerDeadline: Date | null;
  competeAt: Date | null;
  /** 已放弃的不再提醒 */
  status: string;
  award: CompetitionAward | null;
};

/**
 * 抽出还没过去的节点。
 *
 * 三条筛选，每条都有教训在后面：
 * - **已放弃（WITHDRAWN）不出现**。决定不参加了还天天倒计时，提醒就贬值了
 * - **已经有结果（award 非空）的不再提醒报名截止**。比完了的记录留着是档案
 * - **逾期的不留**。课题结题逾期要显示（错过了也得知道），报名截止逾期
 *   则毫无操作空间——报名通道已经关了，留在首页只是每天扎一下
 */
export function upcomingCompetitionDeadlines(
  entries: DeadlineSource[],
  now: Date = new Date(),
): CompetitionDeadline[] {
  const today = todayAsDateOnly(now);
  const out: CompetitionDeadline[] = [];

  for (const entry of entries) {
    if (entry.status === "WITHDRAWN") continue;
    const name = entryTitle(entry);

    if (entry.registerDeadline && entry.award == null) {
      const daysLeft = diffInDays(entry.registerDeadline, today);
      if (daysLeft >= 0) {
        out.push({
          entryId: entry.id,
          kind: "register",
          title: name,
          date: formatDateOnly(entry.registerDeadline),
          daysLeft,
        });
      }
    }

    if (entry.competeAt) {
      const daysLeft = diffInDays(entry.competeAt, today);
      if (daysLeft >= 0) {
        out.push({
          entryId: entry.id,
          kind: "compete",
          title: name,
          date: formatDateOnly(entry.competeAt),
          daysLeft,
        });
      }
    }
  }

  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 倒计时那一行的说明字：「报名截止」「比赛」 */
export const DEADLINE_KIND_LABELS: Record<CompetitionDeadline["kind"], string> = {
  register: "报名截止",
  compete: "比赛",
};

/**
 * 按年度倒序分组。**年度是这个模块的天然刻度**——赛事按年办，
 * 绩效和职称也按年报，列表不按年分组就只剩一条长流水。
 */
export function groupByYear<T extends { year: number }>(
  entries: T[],
): Array<{ year: number; entries: T[] }> {
  const byYear = new Map<number, T[]>();
  for (const entry of entries) {
    byYear.set(entry.year, [...(byYear.get(entry.year) ?? []), entry]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, entries: list }));
}

/**
 * 一组参赛记录的概况。**纯计数，不判定**——「获奖 3 项」是数出来的事实，
 * 「够不够评职称」不在这里也不在别处，那是人看表决定的
 */
export function summarize(
  entries: Array<{ status: string; award: CompetitionAward | null }>,
): { total: number; ongoing: number; awarded: number } {
  return {
    total: entries.length,
    ongoing: entries.filter(
      (entry) =>
        entry.award == null &&
        entry.status !== "WITHDRAWN" &&
        entry.status !== "COMPETED",
    ).length,
    awarded: entries.filter(
      (entry) => entry.award != null && entry.award !== "NONE",
    ).length,
  };
}
