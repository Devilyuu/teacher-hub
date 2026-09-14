import type { Metadata } from "next";
import Link from "next/link";
import { Medal } from "lucide-react";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { ClipboardArt } from "@/components/empty-art";
import { groupByYear, summarize } from "@/lib/competitions";
import { formatDateOnly } from "@/lib/date";
import { getEnabledModules } from "@/lib/module-settings";
import {
  getCompetitionEntries,
  getCompetitions,
  getCompetitionYears,
} from "@/lib/queries/competitions";
import { CompetitionDict } from "./competition-dict";
import { EntryRow } from "./entry-row";
import { NewEntry } from "./new-entry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "参赛" };

/**
 * 指导参赛：历年参赛记录 + 赛事字典。
 *
 * 模块定位（CLAUDE.md「指导参赛」一节）：**参赛的价值一大半在出结果之前**——
 * 报名截止、集训、比赛日期；获奖才是成果。所以这里是过程档案，
 * 获奖由人工「引用为成果」写进台账，系统不自动建（第 1 条铁律）。
 *
 * 赛段不另建表：校赛、省赛、国赛各一条记录，同一「赛事 + 年度」自然聚成
 * 晋级路径——证书按赛段发，一张证书对应一条记录，也对应台账里的一条成果。
 */
export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await getEnabledModules()).competitions) {
    return <ModuleDisabledNotice moduleKey="competitions" />;
  }

  const params = await searchParams;
  const yearParam = typeof params.year === "string" ? Number(params.year) : null;
  const year = yearParam != null && Number.isInteger(yearParam) ? yearParam : null;

  const [entries, competitions, years] = await Promise.all([
    getCompetitionEntries(year != null ? { year } : {}),
    getCompetitions(),
    getCompetitionYears(),
  ]);

  const stats = summarize(entries);
  const groups = groupByYear(entries);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 pt-2">
        <div className="space-y-2">
          <h1 className="page-title">参赛</h1>
          <p className="measure text-muted-foreground">
            指导学生参赛的过程档案：
            <span className="text-foreground">报名截止、比赛日期、队员、证书</span>
            。获奖之后点「引用为成果」才进台账——系统不会自己替你记一笔。
          </p>
        </div>
        {/* 主操作一律右上角实心胶囊（CLAUDE.md 视觉语言） */}
        <NewEntry competitions={competitions} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* 年度筛选。未选中走 well 无阴影，选中才是主色实心 */}
          {years.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              <YearPill href="/competitions" label="全部" active={year == null} />
              {years.map((item) => (
                <YearPill
                  key={item}
                  href={`/competitions?year=${item}`}
                  label={`${item}`}
                  active={year === item}
                />
              ))}
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
              <ClipboardArt className="size-12 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                {year != null
                  ? `${year} 年还没有参赛记录。`
                  : "还没有参赛记录。右上角「新建参赛」，赛事可以在表单里现场添加。"}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                共 {stats.total} 次参赛，{stats.ongoing} 次在进行，
                {stats.awarded} 次获奖。
                <span className="px-1">数出来的，不含任何判定。</span>
              </p>

              {groups.map((group) => (
                <section key={group.year} className="space-y-2">
                  <h2 className="px-1 text-xs font-medium text-muted-foreground tabular-nums">
                    {group.year} 年 · {group.entries.length} 次
                  </h2>
                  {/* 一条记录不是一张卡片：整组共用一张 .surface，行间只用 divide-y */}
                  <ul className="surface divide-y divide-border/40">
                    {group.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={{
                          id: entry.id,
                          year: entry.year,
                          competitionName: entry.competition.name,
                          track: entry.track,
                          level: entry.level,
                          status: entry.status,
                          award: entry.award,
                          awardTitle: entry.awardTitle,
                          myOrder: entry.myOrder,
                          adopted: entry.achievementId != null,
                          memberNames: entry.members.map((member) => member.name),
                          attachmentCount: entry._count.attachments,
                          registerDeadlineText: entry.registerDeadline
                            ? formatDateOnly(entry.registerDeadline)
                            : null,
                          competeText: entry.competeAt
                            ? formatDateOnly(entry.competeAt)
                            : entry.competeDateText,
                        }}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        <CompetitionDict
          rows={competitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            organizer: competition.organizer,
            level: competition.level,
            entryCount: competition._count.entries,
          }))}
        />
      </div>
    </div>
  );
}

function YearPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "inline-flex items-center gap-1 rounded-full bg-well px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
      }
    >
      {active ? <Medal className="size-3" aria-hidden /> : null}
      <span className="tabular-nums">{label}</span>
    </Link>
  );
}
