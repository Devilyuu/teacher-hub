"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
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
import { Button } from "@/components/ui/button";
import {
  convertCapture,
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
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [
    { label: "明天", value: iso(now + day) },
    { label: "下周", value: iso(now + 7 * day) },
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
}: {
  item: InboxCapture;
  advisor: InboxAdvisorContext | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [typeId, setTypeId] = useState(advisor?.types[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
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
            onClick={() => setAssigning((open) => !open)}
          >
            <UsersRound className="size-3.5" aria-hidden />
            归到学生
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

      {advisor && assigning ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="记录类型"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
          >
            {advisor.types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <select
            aria-label="学生"
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            <option value="">全班（不点名）</option>
            {advisor.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={pending || typeId === ""}
            onClick={() =>
              run(() => {
                const data = new FormData();
                data.set("classGroupId", advisor.classGroupId);
                data.set("typeId", typeId);
                data.set("studentId", studentId);
                return convertCaptureToStudentRecord(item.id, data);
              })
            }
          >
            确认
          </Button>
        </div>
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
}: {
  items: InboxCapture[];
  /** 超出首页上限、没显示出来的条数 */
  overflow: number;
  /** 班主任模块开着才传，多一个「归到学生」去向 */
  advisor?: InboxAdvisorContext | null;
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
          <CaptureRow key={item.id} item={item} advisor={advisor} />
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
