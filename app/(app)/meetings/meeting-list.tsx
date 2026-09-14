"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { ClearCalendarArt } from "@/components/empty-art";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { MEETING_TYPE_LABELS } from "@/lib/labels";
import { createAgendaItem, createMeeting, deleteAgendaItem } from "./actions";
import type { MeetingType } from "@/lib/generated/prisma/enums";

export type MeetingRow = {
  id: string;
  title: string;
  meetingTime: Date;
  type: MeetingType;
  hasMinutes: boolean;
  agendaCount: number;
  pendingResolutions: number;
  taskCount: number;
};

export type PoolItem = { id: string; content: string };

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

export function MeetingList({
  meetings,
  pool,
  formatTime,
}: {
  meetings: MeetingRow[];
  pool: PoolItem[];
  /** 时间在服务端格式化好传进来，客户端不重复一套时区逻辑 */
  formatTime: Record<string, string>;
}) {
  const [creating, setCreating] = useState(false);
  const [meetingState, meetingAction] = useActionState(
    createMeeting,
    IDLE_FORM_STATE,
  );
  const [poolState, poolAction] = useActionState(
    createAgendaItem,
    IDLE_FORM_STATE,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {creating ? (
          <form action={meetingAction} className="surface space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">会议名称</Label>
              <Input
                id="title"
                name="title"
                placeholder="如「9 月第一次系部例会」"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="type">类型</Label>
                <select
                  id="type"
                  name="type"
                  defaultValue="REGULAR"
                  className={selectClass}
                >
                  {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="meetingTime">时间</Label>
                <Input
                  id="meetingTime"
                  name="meetingTime"
                  type="datetime-local"
                  required
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton label="新建会议" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreating(false)}
              >
                收起
              </Button>
              {meetingState.message ? (
                <span className="text-xs text-destructive">
                  {meetingState.message}
                </span>
              ) : null}
            </div>
          </form>
        ) : (
          // 主操作和课题、成果、任务页对齐：右上角、实心、同一个形状
          // （CLAUDE.md：同一个动作在不同页面要长一个样）
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              新建会议
            </Button>
          </div>
        )}

        {/* 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片）。
            原来九次会议就是九张各自浮起的大白卡 */}
        {meetings.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
            <ClearCalendarArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              还没有会议记录。开会前把议题拉进议程，开完写纪要、把决议转成任务。
            </p>
          </div>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {meetings.map((meeting) => (
              <li key={meeting.id} className="px-4 py-3">
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  {meeting.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded border px-1.5 py-0.5">
                    {MEETING_TYPE_LABELS[meeting.type]}
                  </span>
                  <span className="tabular-nums">{formatTime[meeting.id]}</span>
                  {meeting.agendaCount > 0 ? (
                    <span>议程 {meeting.agendaCount} 项</span>
                  ) : null}
                  {meeting.hasMinutes ? <span>已写纪要</span> : null}
                  {meeting.taskCount > 0 ? (
                    <span>派生任务 {meeting.taskCount}</span>
                  ) : null}
                  {/* 开完会决议躺在纪要里没派下去，是这个模块最该提醒的事 */}
                  {meeting.pendingResolutions > 0 ? (
                    <span className="text-[var(--h-amber-fg)]">
                      {meeting.pendingResolutions} 条决议未转任务
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 议题池。**开会前想到就记**，不用当场决定放进哪次会——
          临开会前现想想不全，这就是池子存在的理由 */}
      <aside className="space-y-3">
        <h2 className="px-1 text-sm font-medium">议题池</h2>

        <form action={poolAction} className="surface space-y-3 p-4">
          <Input name="content" placeholder="想到一条先记下" required />
          <div className="flex items-center gap-2">
            <SubmitButton label="记下" />
            {poolState.message ? (
              <span
                className={
                  formMessageClass(poolState.ok)
                }
              >
                {poolState.message}
              </span>
            ) : null}
          </div>
        </form>

        {pool.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">池子是空的。</p>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {pool.map((item) => (
              <li key={item.id} className="flex items-start gap-2 px-3.5 py-2">
                <span className="min-w-0 flex-1 text-xs">{item.content}</span>
                {/* 议题是硬删，没有回收站，所以问一句 */}
                <ConfirmSubmitButton
                  action={deleteAgendaItem.bind(null, item.id)}
                  message={`删除议题「${item.content}」？删了就找不回来了。`}
                  size="icon-sm"
                  label={`删除议题 ${item.content}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </ConfirmSubmitButton>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
