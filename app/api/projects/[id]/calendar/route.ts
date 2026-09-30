import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcs, icsResponse } from "@/lib/ics";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 课题截止日 → 手机日历（全天事件），口径见 `lib/ics.ts`。
 *
 * `GET /api/projects/<id>/calendar?deadline=closing|apply`
 *
 * 结题截止和申报截止各是一条事件，标题和月历页上的一致
 * （「结题截止·简称」/「申报截止·简称」），在手机上认得出是同一件事
 */
const DEADLINES = {
  closing: { field: "closingDeadline", label: "结题截止" },
  apply: { field: "applyDeadline", label: "申报截止" },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const which = new URL(request.url).searchParams.get("deadline");
  if (which !== "closing" && which !== "apply") {
    return new NextResponse("deadline 只能是 closing 或 apply", { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id: (await params).id },
    select: { id: true, title: true, shortTitle: true, closingDeadline: true, applyDeadline: true },
  });
  if (!project) {
    return new NextResponse("课题不存在", { status: 404 });
  }
  const date = project[DEADLINES[which].field];
  if (!date) {
    return new NextResponse("这个课题没填这个截止日", { status: 404 });
  }

  const summary = `${DEADLINES[which].label}·${project.shortTitle ?? project.title}`;
  const body = buildIcs({
    uid: `project-${project.id}-${which}@teacher-desk`,
    summary,
    url: new URL(`/projects/${project.id}`, request.url).toString(),
    allDay: true,
    date,
  });

  return icsResponse(body, summary);
}
