import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildMeetingIcs, icsResponse } from "@/lib/ics";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 会议 → 手机日历（.ics），口径见 `lib/ics.ts`。
 *
 * `GET /api/meetings/<id>/calendar`
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const meeting = await prisma.meeting.findUnique({
    where: { id: (await params).id },
    select: { id: true, title: true, meetingTime: true },
  });
  if (!meeting) {
    return new NextResponse("会议不存在", { status: 404 });
  }

  const body = buildMeetingIcs(meeting, {
    // 点日历里的链接回到这场会的详情页。生产反代透传了 Host 与 X-Forwarded-Proto，
    // request.url 就是用户看到的那个域名
    url: new URL(`/meetings/${meeting.id}`, request.url).toString(),
  });

  return icsResponse(body, meeting.title);
}
