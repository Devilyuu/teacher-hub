"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookUser,
  Clock,
  Inbox,
  ListTodo,
  PenLine,
  Sparkles,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DecorTile } from "@/components/decor-tile";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import { Button } from "@/components/ui/button";
import {
  convertCapture,
  convertCaptureToMenteeRecord,
  convertCaptureToStudentRecord,
  dismissCapture,
  restoreCapture,
  snoozeCapture,
} from "@/lib/actions/capture-actions";
import {
  CAPTURE_KIND_LABELS,
  CAPTURE_TARGET_LABELS,
  type CaptureKind,
} from "@/lib/capture";
import { formatTimestampDate } from "@/lib/format";

export type InboxCapture = {
  id: string;
  kind: CaptureKind;
  title: string;
  content: string | null;
  createdAt: Date;
  /** 到期回来的延期记录，界面上标一下「延期到今天」 */
  wasSnoozed: boolean;
};

/** 班主任模块开着才有：速记可以归到某个学生名下（谈话/事件） */
export type InboxAdvisorContext = {
  classGroupId: string;
  students: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string }>;
};

/**
 * 学业导师模块开着才有：速记可以归到某个导师学生名下（指导记录）。
 *
 * **和上面那个是两份**：advisor = 班主任（班级 + 在册学生），
 * mentor = 学业导师（批次 + 名单）。两个模块可以同时开着，
 * 那时收件箱里会并排出现两个去向按钮——所以文案和图标都不能重。
 */
export type InboxMentorContext = {
  batchId: string;
  mentees: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string }>;
};

/** 归类面板：选类型 + 选人（可不选）+ 确认。两个模块共用这一个形状 */
function AssignPanel({
  types,
  members,
  allLabel,
  memberLabel,
  pending,
  onSubmit,
}: {
  types: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  /** 不点名时的选项文案，「全班（不点名）」/「全批（不点名）」 */
  allLabel: string;
  memberLabel: string;
  pending: boolean;
  onSubmit: (typeId: string, memberId: string) => void;
}) {
  // 面板是条件渲染的，每次打开都会重新挂载，所以初值取第一个类型就够了
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [memberId, setMemberId] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="记录类型"
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none"
        value={typeId}
        onChange={(event) => setTypeId(event.target.value)}
      >
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </select>
      <select
        aria-label={memberLabel}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none"
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
      >
        <option value="">{allLabel}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        disabled={pending || typeId === ""}
        onClick={() => onSubmit(typeId, memberId)}
      >
        确认
      </Button>
    </div>
  );
}

function KindBadge({ kind }: { kind: CaptureKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {CAPTURE_KIND_LABELS[kind]}
    </span>
  );
}

/** 延期选项。「明天 / 下周」覆盖绝大多数情况，不做日期选择器——那又是一次点击 */
function snoozeDates(): Array<{ label: string; value: string }> {
  // 走 lib/date.ts 的纯日期口径。原来是 `toISOString().slice(0, 10)`——
  // 那取的是 UTC 日期，东八区 00:00–08:00 之间「明天」会算成今天，
  // 速记延期到当天、不报错（2026-09-15 审核发现）
  const today = todayAsDateOnly();
  const plusDays = (days: number) =>
    formatDateOnly(new Date(today.getTime() + days * 86_400_000));
  return [
    { label: "明天", value: plusDays(1) },
    { label: "下周", value: plusDays(7) },
  ];
}

/* 类型徽章里的小图标。速记三种类型的字都很短（随记/待办/成果线索），
   扫一眼分不开，给个形状比读字快 */
const KIND_ICONS: Record<CaptureKind, LucideIcon> = {
  TASK: ListTodo,
  ACHIEVEMENT: Sparkles,
  NOTE: PenLine,
};

function CaptureRow({
  item,
  advisor,
  mentor,
}: {
  item: InboxCapture;
  advisor: InboxAdvisorContext | null;
  mentor: InboxMentorContext | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 一次只开一个归类面板：两个模块都开着时，两个面板同屏会分不清
  // 上面那排选择框是在往哪张表里归
  const [assigning, setAssigning] = useState<"advisor" | "mentor" | null>(null);
  const dates = snoozeDates();

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      const result = (await fn()) as
        { ok?: boolean; message?: string } | undefined;
      if (result && result.ok === false && result.message)
        setError(result.message);
    });
  }

  function snooze(value: string) {
    const data = new FormData();
    data.set("snoozedUntil", value);
    run(() => snoozeCapture(item.id, { ok: false }, data));
  }

  return (
    <li className="surface space-y-2 p-3.5" aria-busy={pending}>
      <div className="flex flex-wrap items-start gap-2">
        <KindBadge kind={item.kind} />
        <p className="min-w-0 flex-1 text-sm">{item.title}</p>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {item.wasSnoozed ? "延期到今天" : formatTimestampDate(item.createdAt)}
        </span>
      </div>

      {item.content ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {item.content}
        </p>
      ) : null}

      {/* 每条至少一个直接动作（规格 §7.2）。转换是主动作，用实心按钮 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => run(() => convertCapture(item.id))}
        >
          <ArrowRight className="size-3.5" aria-hidden />
          转为{CAPTURE_TARGET_LABELS[item.kind]}
        </Button>

        {dates.map((date) => (
          <Button
            key={date.value}
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() => snooze(date.value)}
          >
            <Clock className="size-3.5" aria-hidden />
            {date.label}
          </Button>
        ))}

        {advisor ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() =>
              setAssigning((open) => (open === "advisor" ? null : "advisor"))
            }
          >
            <UsersRound className="size-3.5" aria-hidden />
            归到学生
          </Button>
        ) : null}

        {/* 两个模块都开着时这两个按钮并排出现，所以**文案和图标都不能重**：
            「归到学生」是班主任的班，「归到导师学生」是双选带的那一批 */}
        {mentor ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() =>
              setAssigning((open) => (open === "mentor" ? null : "mentor"))
            }
          >
            <BookUser className="size-3.5" aria-hidden />
            归到导师学生
          </Button>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          disabled={pending}
          // 服务端早就是软删（status → DISMISSED）并配好了 restoreCapture，
          // 只是界面上从来没给过找回的机会。随手记的东西最容易手快点错
          onClick={() =>
            run(async () => {
              await dismissCapture(item.id);
              toast("已忽略这条速记", {
                description: item.title,
                duration: 8000,
                action: { label: "撤销", onClick: () => void restoreCapture(item.id) },
              });
            })
          }
        >
          <X className="size-3.5" aria-hidden />
          不要了
        </Button>
      </div>

      {advisor && assigning === "advisor" ? (
        <AssignPanel
          types={advisor.types}
          members={advisor.students}
          allLabel="全班（不点名）"
          memberLabel="学生"
          pending={pending}
          onSubmit={(typeId, studentId) =>
            run(() => {
              const data = new FormData();
              data.set("classGroupId", advisor.classGroupId);
              data.set("typeId", typeId);
              data.set("studentId", studentId);
              return convertCaptureToStudentRecord(item.id, data);
            })
          }
        />
      ) : null}

      {mentor && assigning === "mentor" ? (
        <AssignPanel
          types={mentor.types}
          members={mentor.mentees}
          allLabel="全批（不点名）"
          memberLabel="导师学生"
          pending={pending}
          onSubmit={(typeId, menteeId) =>
            run(() => {
              const data = new FormData();
              data.set("batchId", mentor.batchId);
              data.set("typeId", typeId);
              data.set("menteeId", menteeId);
              return convertCaptureToMenteeRecord(item.id, data);
            })
          }
        />
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

/**
 * 首页收件箱（二期规格 §7.1）。
 *
 * **「收件箱」这个名字专指这里**——待归类的速记。首页上面那块任务视图叫
 * 「今天要处理」（`components/today-queue.tsx`）。两个都叫收件箱的话，
 * 用户会说不清自己随手记的那条在哪个箱子里。
 *
 * 转成正式记录之前，这里的东西**不进任何统计和导出**：
 * 采集不等于事实（第一性原理第 1 条）。
 */
export function CaptureInbox({
  items,
  overflow,
  advisor = null,
  mentor = null,
}: {
  items: InboxCapture[];
  /** 超出首页上限、没显示出来的条数 */
  overflow: number;
  /** 班主任模块开着才传，多一个「归到学生」去向 */
  advisor?: InboxAdvisorContext | null;
  /** 学业导师模块开着才传，多一个「归到导师学生」去向 */
  mentor?: InboxMentorContext | null;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <DecorTile icon={Inbox} domain="capture" />
        <h2 className="text-base font-semibold">收件箱</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {items.length + overflow}
        </span>
        <span className="text-xs text-muted-foreground">归类后才进台账</span>
      </div>

      {/* 中间调托盘。收件箱是个「箱」：白卡是记录本体，托盘装着它们，
          和左栏那些已经归了类的任务卡在明度上隔开一层 */}
      <ul className="space-y-2 rounded-3xl bg-well p-2">
        {items.map((item) => (
          <CaptureRow key={item.id} item={item} advisor={advisor} mentor={mentor} />
        ))}
      </ul>

      {overflow > 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          还有 {overflow} 条没显示。
          <Link href="/tasks" className="ml-1 underline underline-offset-4">
            先处理完这些
          </Link>
        </p>
      ) : null}
    </section>
  );
}
