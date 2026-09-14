import type { Metadata } from "next";
import { formatTimestamp } from "@/lib/format";
import { parseAgenda, pendingResolutionCount } from "@/lib/meetings";
import { getMeetings, getPendingAgendaItems } from "@/lib/queries/routines";
import { MeetingList } from "./meeting-list";

import { RoutineTabs } from "@/components/routine-tabs";
import { getEnabledModules } from "@/lib/module-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "会议" };

export default async function MeetingsPage() {
  const [meetings, pool, modules] = await Promise.all([
    getMeetings(),
    getPendingAgendaItems(),
    getEnabledModules(),
  ]);

  const rows = meetings.map((meeting) => ({
    id: meeting.id,
    title: meeting.title,
    meetingTime: meeting.meetingTime,
    type: meeting.type,
    hasMinutes: Boolean(meeting.minutes?.trim()),
    agendaCount: parseAgenda(meeting.agenda).length,
    pendingResolutions: pendingResolutionCount(meeting.resolutions),
    taskCount: meeting._count.tasks,
  }));

  // 时间在服务端格式化，客户端组件不重复一套时区逻辑
  const formatTime = Object.fromEntries(
    meetings.map((meeting) => [meeting.id, formatTimestamp(meeting.meetingTime)]),
  );

  return (
    <div className="space-y-6">
      <RoutineTabs modules={modules} />

      <header className="space-y-2 pt-2">
        <h1 className="page-title">会议</h1>
        <p className="measure text-muted-foreground">
          会前把议题拉进议程，会后写纪要、把决议转成任务——开会定下的事不该只躺在纪要里。
        </p>
      </header>

      <MeetingList meetings={rows} pool={pool} formatTime={formatTime} />
    </div>
  );
}
