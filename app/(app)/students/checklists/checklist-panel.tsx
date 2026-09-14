"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { createChecklist } from "../actions";

export type ChecklistRow = {
  id: string;
  title: string;
  dueDateText: string | null;
  note: string | null;
  closed: boolean;
  checkedCount: number;
  /** 在班人数。分母不属于单子自己，服务端算好传进来 */
  activeCount: number;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "创建中…" : "创建"}
    </Button>
  );
}

function ChecklistItem({ row }: { row: ChecklistRow }) {
  const done = row.checkedCount >= row.activeCount && row.activeCount > 0;
  return (
    <li>
      <Link
        href={`/students/checklists/${row.id}`}
        className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <p className={row.closed ? "text-sm text-muted-foreground" : "text-sm"}>
            {row.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {row.dueDateText ? <span className="tabular-nums">截止 {row.dueDateText}</span> : null}
            {row.note ? <span>{row.note}</span> : null}
          </p>
        </div>
        {/* 只数不判定：X/N 是计数，「收齐了没」由人看着办 */}
        <span
          className={
            done
              ? "text-sm font-medium tabular-nums"
              : "text-sm text-muted-foreground tabular-nums"
          }
        >
          {row.checkedCount}/{row.activeCount}
        </span>
      </Link>
    </li>
  );
}

export function ChecklistPanel({
  classGroupId,
  rows,
}: {
  classGroupId: string;
  rows: ChecklistRow[];
}) {
  const [creating, setCreating] = useState(false);
  const [state, action] = useActionState(
    createChecklist.bind(null, classGroupId),
    IDLE_FORM_STATE,
  );

  const open = rows.filter((row) => !row.closed);
  const closed = rows.filter((row) => row.closed);

  return (
    <div className="space-y-4">
      {creating ? (
        <form action={action} className="surface space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="space-y-1.5">
              <Label htmlFor="checklist-title">收什么</Label>
              <Input
                id="checklist-title"
                name="title"
                placeholder="如「保险单回执」「实习协议」"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="checklist-due">截止日（可空）</Label>
              <Input id="checklist-due" name="dueDate" type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checklist-note">备注</Label>
            <Input id="checklist-note" name="note" placeholder="可空" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton />
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
              收起
            </Button>
            {state.message ? (
              <span className={formMessageClass(state.ok)}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            新建收缴
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <ClipboardArt className="size-12 text-muted-foreground/60" />
          <p className="measure text-sm text-muted-foreground">
            还没有收缴项。收回执、收保险单、交问卷——建一条，交一个勾一个，没交的一键复制去群里催。
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 ? (
            <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
              {open.map((row) => (
                <ChecklistItem key={row.id} row={row} />
              ))}
            </ul>
          ) : null}

          {closed.length > 0 ? (
            /* 归档折叠条走 well——「虚」的东西不上白卡（视觉语言） */
            <details className="rounded-3xl bg-well px-5 py-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                已结束（{closed.length}）
              </summary>
              <ul className="mt-2 divide-y divide-border/40">
                {closed.map((row) => (
                  <ChecklistItem key={row.id} row={row} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
