import { NextResponse } from "next/server";
import { entryTitle } from "@/lib/competitions";
import { prisma } from "@/lib/db";
import { buildIcs, icsResponse } from "@/lib/ics";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 参赛记录的报名截止 / 比赛日 → 手机日历（全天事件），口径见 `lib/ics.ts`。
 *
 * `GET /api/competitions/<id>/calendar?date=register|compete`
 *
 * 标题和月历页上的一致（「报名截止·…」/「比赛·…」）。
 * 比赛日只有精确到日才有 `competeAt`，只知道「五月中旬」的在 `competeDateText` 里，
 * 导不了也不猜（CLAUDE.md 第 8 条铁律）
 */
const DATES = {
  register: { field: "registerDeadline", label: "报名截止" },
  compete: { field: "competeAt", label: "比赛" },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const which = new URL(request.url).searchParams.get("date");
  if (which !== "register" && which !== "compete") {
    return new NextResponse("date 只能是 register 或 compete", { status: 400 });
  }

  const entry = await prisma.competitionEntry.findUnique({
    where: { id: (await params).id },
    select: {
      id: true,
      year: true,
      track: true,
      level: true,
      registerDeadline: true,
      competeAt: true,
      competition: { select: { name: true } },
    },
  });
  if (!entry) {
    return new NextResponse("参赛记录不存在", { status: 404 });
  }
  const date = entry[DATES[which].field];
  if (!date) {
    return new NextResponse("这条参赛记录没填这个日期", { status: 404 });
  }

  const summary = `${DATES[which].label}·${entryTitle({
    year: entry.year,
    competitionName: entry.competition.name,
    track: entry.track,
    level: entry.level,
  })}`;
  const body = buildIcs({
    uid: `competition-${entry.id}-${which}@teacher-desk`,
    summary,
    url: new URL(`/competitions/${entry.id}`, request.url).toString(),
    allDay: true,
    date,
  });

  return icsResponse(body, summary);
}
