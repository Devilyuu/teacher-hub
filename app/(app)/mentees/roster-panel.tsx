"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2, UserRoundMinus, UserRoundPlus } from "lucide-react";
import { ClipboardArt } from "@/components/empty-art";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import {
  bulkImportMentees,
  createMentee,
  deleteMentee,
  setMenteeActive,
} from "./actions";

export type MenteeRow = {
  id: string;
  name: string;
  studentNo: string | null;
  className: string | null;
  phone: string | null;
  note: string | null;
  active: boolean;
  /** 已挂到班主任名册上的在册学生（两个模块都开着时才可能有） */
  linkedStudent: boolean;
  recordCount: number;
  /** 「03-14 · 毕设指导」，没有记录时为 null */
  lastRecordText: string | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

function AddMenteeForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const [state, action] = useActionState(
    createMentee.bind(null, batchId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="mentee-name">姓名</Label>
          <Input id="mentee-name" name="name" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mentee-class">班级</Label>
          <Input id="mentee-class" name="className" placeholder="如「数媒2301」" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mentee-no">学号</Label>
          <Input id="mentee-no" name="studentNo" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mentee-phone">手机</Label>
          <Input id="mentee-phone" name="phone" />
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="mentee-note">备注</Label>
          <Input
            id="mentee-note"
            name="note"
            placeholder="专业方向、想不想专转本、家里情况…"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="添加" />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          收起
        </Button>
        {state.message ? (
          <span className={formMessageClass(state.ok)}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

function BulkImportForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const [state, action] = useActionState(
    bulkImportMentees.bind(null, batchId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-3 p-5">
      <div className="space-y-1.5">
        <Label htmlFor="mentee-bulk-lines">粘贴名单，一行一个学生</Label>
        <textarea
          id="mentee-bulk-lines"
          name="lines"
          rows={8}
          required
          placeholder={
            "双选结果从 Excel 整块复制过来即可。列序：\n姓名\t学号\t班级\t手机\n后三列都可以没有，只贴一列姓名也行。"
          }
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="measure text-xs text-muted-foreground">
          已在名单里的同名学生会跳过，所以整表重复粘贴是安全的。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label="导入" />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          收起
        </Button>
        {state.message ? (
          <span className={formMessageClass(state.ok)}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

export function MenteeRosterPanel({
  batchId,
  mentees,
}: {
  batchId: string;
  mentees: MenteeRow[];
}) {
  const [mode, setMode] = useState<"idle" | "add" | "import">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {mode === "idle" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="bg-well"
              onClick={() => setMode("import")}
            >
              批量导入
            </Button>
            <Button type="button" onClick={() => setMode("add")}>
              <Plus className="size-4" aria-hidden />
              新增学生
            </Button>
          </>
        ) : null}
      </div>

      {mode === "add" ? (
        <AddMenteeForm batchId={batchId} onDone={() => setMode("idle")} />
      ) : null}
      {mode === "import" ? (
        <BulkImportForm batchId={batchId} onDone={() => setMode("idle")} />
      ) : null}

      {mentees.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <ClipboardArt className="size-12 text-muted-foreground/60" />
          <p className="measure text-sm text-muted-foreground">
            名单还是空的。点「批量导入」把双选结果整块粘过来，一分钟完事。
          </p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>班级</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>手机</TableHead>
                <TableHead>最近一次指导</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-[5.5rem]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mentees.map((mentee) => (
                <TableRow
                  key={mentee.id}
                  className={mentee.active ? undefined : "opacity-50"}
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {mentee.name}
                    {mentee.active ? "" : "（已毕业）"}
                    {mentee.linkedStudent ? (
                      <span
                        className="ml-1.5 text-xs font-normal text-muted-foreground"
                        title="这名学生同时在班主任名册里"
                      >
                        ·在册
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[9rem] text-muted-foreground">
                    <span className="line-clamp-1" title={mentee.className ?? undefined}>
                      {mentee.className ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {mentee.studentNo ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {mentee.phone ?? "—"}
                  </TableCell>
                  {/* 只显示事实，不算「多久没见了」——那是判定（第 1 条铁律） */}
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {mentee.lastRecordText ?? "还没有记录"}
                    {mentee.recordCount > 1 ? (
                      <span className="ml-1.5 text-xs tabular-nums">
                        共 {mentee.recordCount} 次
                      </span>
                    ) : null}
                  </TableCell>
                  {/* 长文本列限宽 + clamp + title 存全文（CLAUDE.md 视觉语言） */}
                  <TableCell className="max-w-[14rem]">
                    <span className="line-clamp-1 text-muted-foreground" title={mentee.note ?? undefined}>
                      {mentee.note ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-0.5">
                      {/* 毕业/退出是可逆的，不弹确认 */}
                      <form
                        action={setMenteeActive.bind(null, mentee.id, !mentee.active)}
                      >
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground"
                          aria-label={
                            mentee.active
                              ? `把 ${mentee.name} 标记为已毕业`
                              : `把 ${mentee.name} 恢复为在带`
                          }
                          title={mentee.active ? "标记为已毕业 / 退出" : "恢复为在带"}
                        >
                          {mentee.active ? (
                            <UserRoundMinus className="size-3.5" aria-hidden />
                          ) : (
                            <UserRoundPlus className="size-3.5" aria-hidden />
                          )}
                        </Button>
                      </form>
                      {/* 硬删找不回来，走确认，且文案写清后果 */}
                      <ConfirmSubmitButton
                        action={async () => {
                          const result = await deleteMentee(mentee.id);
                          setDeleteError(result.ok ? null : (result.message ?? null));
                        }}
                        message={
                          // **文案承诺的事界面上必须做得到**（CLAUDE.md）。
                          // recordCount 是「提到过他的记录数」，其中和别人一起的
                          // 那几条不会删——所以这里不报那个数，只把两种去向说清楚
                          mentee.recordCount > 0
                            ? `删除 ${mentee.name}？只提到他一人的指导记录会跟着删掉；和别人一起的记录留下，只是不再记着他。都找不回来。只是带完了的话用「标记为已毕业」。`
                            : `删除 ${mentee.name}？找不回来。`
                        }
                        size="icon-sm"
                        label={`删除 ${mentee.name}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </ConfirmSubmitButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {deleteError ? <p className="px-1 text-xs text-destructive">{deleteError}</p> : null}
    </div>
  );
}
