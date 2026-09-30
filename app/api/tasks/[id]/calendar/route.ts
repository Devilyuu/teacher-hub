import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcs, icsResponse } from "@/lib/ics";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 任务到期日 → 手机日历（全天事件），口径见 `lib/ics.ts`。
 *
 * `GET /api/tasks/<id>/calendar`
 *
 * 任务没有整体导出——几十条、天天变，勾完成后手机上那条照样响。
 * 这个接口给的是「挑一两条真怕忘的」（2026-09-22 用户定），
 * 所以只认没到期日就 404，不去猜一个
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const task = await prisma.task.findUnique({
    where: { id: (await params).id, deletedAt: null },
    select: { id: true, title: true, dueDate: true },
  });
  if (!task) {
    return new NextResponse("任务不存在", { status: 404 });
  }
  if (!task.dueDate) {
    return new NextResponse("这条任务没填到期日", { status: 404 });
  }

  const body = buildIcs({
    uid: `task-${task.id}@teacher-desk`,
    summary: task.title,
    url: new URL("/tasks", request.url).toString(),
    allDay: true,
    date: task.dueDate,
  });

  return icsResponse(body, task.title);
}
