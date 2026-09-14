"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSemester, deleteSemester } from "@/lib/actions/semester-actions";
import { IDLE_FORM_STATE } from "@/lib/form-state";

/** 行数据由服务端算好传进来：周次口径只有 lib/semester.ts 一处，客户端不重算 */
export type SemesterRowData = {
  id: string;
  name: string;
  /** 开学日 YYYY-MM-DD，服务端 formatDateOnly 的结果 */
  startText: string;
  /** 「第 N 教学周」「未开学」「已结束」 */
  hint: string;
  /** 正处于这个学期的教学周里 */
  current: boolean;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Plus className="size-3.5" aria-hidden />
      {pending ? "设置中…" : "设置新学期"}
    </Button>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <>
      {errors.map((error) => (
        <p key={error} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </>
  );
}

export function SemesterPanel({ rows }: { rows: SemesterRowData[] }) {
  const [state, action] = useActionState(createSemester, IDLE_FORM_STATE);

  return (
    <div className="surface">
      {rows.length > 0 ? (
        <ul className="divide-y divide-border/40">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {row.name}
                  <span
                    className={
                      row.current
                        ? "ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium"
                        : "ml-2 text-xs font-normal text-muted-foreground"
                    }
                  >
                    {row.hint}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  开学 {row.startText}
                </p>
              </div>
              <form action={deleteSemester.bind(null, row.id)}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`删除学期 ${row.name}`}
                  onClick={(event) => {
                    if (!confirm(`删除学期「${row.name}」？`))
                      event.preventDefault();
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-xs text-muted-foreground">
          还没设过学期。设上开学日，首页问候就会显示「第 N 教学周」。
        </p>
      )}

      <form
        action={action}
        className="space-y-3 border-t border-border/40 px-5 py-4"
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="semester-name">学期名</Label>
            <Input
              id="semester-name"
              name="name"
              placeholder="如 2026-2027-1"
              required
              aria-invalid={state.fieldErrors?.name ? true : undefined}
            />
            <FieldErrors errors={state.fieldErrors?.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="semester-start">开学日（第一周）</Label>
            <Input
              id="semester-start"
              name="startDate"
              type="date"
              required
              aria-invalid={state.fieldErrors?.startDate ? true : undefined}
            />
            <FieldErrors errors={state.fieldErrors?.startDate} />
          </div>
          <SubmitButton />
        </div>
        {state.message ? (
          <p
            className={
              state.ok
                ? "text-xs text-muted-foreground"
                : "text-xs text-destructive"
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
