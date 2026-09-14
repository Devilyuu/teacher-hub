import Link from "next/link";
import { Paperclip, Users } from "lucide-react";
import {
  COMPETITION_AWARD_LABELS,
  COMPETITION_STATUS_LABELS,
  LEVEL_LABELS,
} from "@/lib/labels";
import type { CompetitionAward, CompetitionStatus, Level } from "@/lib/generated/prisma/enums";

export type EntryRowData = {
  id: string;
  year: number;
  competitionName: string;
  track: string | null;
  level: Level;
  status: CompetitionStatus;
  award: CompetitionAward | null;
  awardTitle: string | null;
  myOrder: number | null;
  adopted: boolean;
  memberNames: string[];
  attachmentCount: number;
  registerDeadlineText: string | null;
  competeText: string | null;
};

/**
 * 列表里的一行。**上下文塞进行里**（CLAUDE.md：列表要密）——
 * 赛项、级别、队员、日期全在一行两栏里，不为一条 20 字的记录开一张卡。
 *
 * 奖项徽章走中性色：健康度那六个语义色只归 components/health.tsx 用，
 * 拿绿色标「获奖」会和「结题要求已齐备」撞车。
 */
export function EntryRow({ entry }: { entry: EntryRowData }) {
  const awardText = entry.awardTitle
    ? entry.awardTitle
    : entry.award
      ? COMPETITION_AWARD_LABELS[entry.award]
      : null;

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <Link
          href={`/competitions/${entry.id}`}
          className="min-w-0 text-sm font-medium underline-offset-4 hover:underline"
        >
          {entry.competitionName}
          {entry.track ? (
            <span className="text-muted-foreground"> · {entry.track}</span>
          ) : null}
        </Link>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-well px-2 py-0.5 text-[11px] text-muted-foreground">
            {LEVEL_LABELS[entry.level]}
          </span>
          {awardText ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
              {awardText}
            </span>
          ) : (
            <span className="rounded-full bg-well px-2 py-0.5 text-[11px] text-muted-foreground">
              {COMPETITION_STATUS_LABELS[entry.status]}
            </span>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {entry.registerDeadlineText ? (
          <span className="tabular-nums">报名截止 {entry.registerDeadlineText}</span>
        ) : null}
        {entry.competeText ? (
          <span className="tabular-nums">比赛 {entry.competeText}</span>
        ) : null}
        {entry.myOrder != null ? <span>第{entry.myOrder}指导</span> : null}
        {entry.memberNames.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden />
            {/* 队员多的时候只列前三个，剩下的收成「等 N 人」——
                一行里塞八个名字会把日期挤到看不见 */}
            {entry.memberNames.slice(0, 3).join("、")}
            {entry.memberNames.length > 3 ? `等 ${entry.memberNames.length} 人` : ""}
          </span>
        ) : null}
        {entry.attachmentCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="size-3" aria-hidden />
            {entry.attachmentCount}
          </span>
        ) : null}
        {entry.adopted ? (
          <span className="text-foreground">已引用为成果</span>
        ) : null}
      </div>
    </li>
  );
}
