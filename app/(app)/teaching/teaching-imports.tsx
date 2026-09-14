"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowUpRight, FileText, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACHIEVEMENT_TYPE_OPTIONS } from "@/lib/options";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { formatTimestampDate } from "@/lib/format";
import {
  adoptTeachingImport,
  dismissTeachingImport,
  restoreTeachingImport,
} from "./actions";

export type TeachingImportRow = {
  id: string;
  title: string;
  courseName: string | null;
  /** 形如 `2025-2026 第二学期`。同一门课教了几个学期，就是几条记录 */
  term: string | null;
  /** 已格式化的完成日期；纯日期列在服务端用 lib/date.ts 格式化后传下来 */
  finishedAtText: string | null;
  receivedAt: Date;
  status: "RECEIVED" | "ADOPTED" | "DISMISSED" | "FAILED";
  failureReason: string | null;
  achievementId: string | null;
  attachmentCount: number;
};

/**
 * 状态用**文字**不用颜色。
 *
 * 六个语义色只归 `components/health.tsx`（CLAUDE.md 视觉语言）——
 * 这里给回流记录上色，看板上的绿点就会失去"结题要求已齐备"那个唯一含义
 */
const STATUS_LABELS: Record<TeachingImportRow["status"], string> = {
  RECEIVED: "待处理",
  ADOPTED: "已引用",
  DISMISSED: "已忽略",
  FAILED: "接收出错",
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function AdoptForm({ row, onDone }: { row: TeachingImportRow; onDone: () => void }) {
  const [state, formAction] = useActionState(adoptTeachingImport, IDLE_FORM_STATE);

  if (state.ok) {
    // 成功后由 revalidatePath 刷新列表，这里只负责把表单收起来
    queueMicrotask(onDone);
  }

  return (
    <form action={formAction} className="space-y-3 border-t border-border/40 px-4 py-4">
      <input type="hidden" name="importId" value={row.id} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`title-${row.id}`} className="text-xs">
            成果名称
          </Label>
          <Input
            id={`title-${row.id}`}
            name="title"
            defaultValue={row.title}
            className="h-9"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`type-${row.id}`} className="text-xs">
            成果类型
          </Label>
          {/* 原生 select：shadcn 的 Select 不进 FormData，而 Server Action 靠它取值 */}
          <select
            id={`type-${row.id}`}
            name="type"
            defaultValue="COURSE"
            className="h-9 w-full rounded-full border border-input bg-transparent px-3 text-sm"
          >
            {ACHIEVEMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`year-${row.id}`} className="text-xs">
            年度
          </Label>
          <Input
            id={`year-${row.id}`}
            name="year"
            inputMode="numeric"
            defaultValue={String(new Date().getFullYear())}
            className="h-9"
            required
          />
        </div>
      </div>

      {state.message && !state.ok ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton label="确认引用" pendingLabel="引用中…" />
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          取消
        </Button>
      </div>
    </form>
  );
}

export function TeachingImports({ rows }: { rows: TeachingImportRow[] }) {
  const [adopting, setAdopting] = useState<string | null>(null);

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">教案</th>
              <th className="px-4 py-3 font-medium">课程</th>
              <th className="px-4 py-3 font-medium">学期</th>
              <th className="px-4 py-3 font-medium">完成</th>
              <th className="px-4 py-3 font-medium">收到</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/40 last:border-0">
                {/* 长文本必须限宽：不限宽单它一列就能把表格撑到横滚 */}
                <td className="max-w-[22rem] px-4 py-3">
                  <span className="line-clamp-2 font-medium" title={row.title}>
                    {row.title}
                  </span>
                  {row.attachmentCount > 0 ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="size-3" aria-hidden />
                      {row.attachmentCount} 份附件
                    </span>
                  ) : null}
                  {row.failureReason ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground" title={row.failureReason}>
                      <span className="line-clamp-1">{row.failureReason}</span>
                    </span>
                  ) : null}
                </td>
                <td className="max-w-[10rem] px-4 py-3 text-muted-foreground">
                  <span className="line-clamp-1" title={row.courseName ?? undefined}>
                    {row.courseName ?? "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {row.term ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {row.finishedAtText ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatTimestampDate(row.receivedAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {STATUS_LABELS[row.status]}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {row.status === "ADOPTED" && row.achievementId ? (
                    <Button
                      render={<Link href={`/achievements/${row.achievementId}`} />}
                      nativeButton={false}
                      size="sm"
                      variant="outline"
                    >
                      <ArrowUpRight className="size-3.5" aria-hidden />
                      查看成果
                    </Button>
                  ) : row.status === "DISMISSED" ? (
                    <form action={restoreTeachingImport} className="inline">
                      <input type="hidden" name="importId" value={row.id} />
                      <Button type="submit" size="sm" variant="outline">
                        <Undo2 className="size-3.5" aria-hidden />
                        撤销忽略
                      </Button>
                    </form>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setAdopting(adopting === row.id ? null : row.id)}
                      >
                        引用为成果
                      </Button>
                      <form action={dismissTeachingImport} className="inline">
                        <input type="hidden" name="importId" value={row.id} />
                        <Button type="submit" size="sm" variant="outline">
                          <X className="size-3.5" aria-hidden />
                          忽略
                        </Button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adopting ? (
        <AdoptForm
          row={rows.find((row) => row.id === adopting)!}
          onDone={() => setAdopting(null)}
        />
      ) : null}
    </div>
  );
}
