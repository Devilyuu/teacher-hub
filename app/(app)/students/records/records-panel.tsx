"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { InboxTrayArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import {
  createRecordType,
  createStudentRecord,
  deleteRecordType,
  deleteStudentRecord,
} from "../actions";

export type RecordTypeRow = {
  id: string;
  name: string;
  recordCount: number;
};

export type RecordRow = {
  id: string;
  dateText: string;
  typeName: string;
  memberNames: string[];
  content: string;
};

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

export function RecordsPanel({
  classGroupId,
  types,
  students,
  records,
  todayText,
}: {
  classGroupId: string;
  types: RecordTypeRow[];
  students: Array<{ id: string; name: string }>;
  records: RecordRow[];
  todayText: string;
}) {
  const [creating, setCreating] = useState(false);
  const [recordState, recordAction] = useActionState(
    createStudentRecord.bind(null, classGroupId),
    IDLE_FORM_STATE,
  );
  const [typeState, typeAction] = useActionState(createRecordType, IDLE_FORM_STATE);
  const [typeDeleteState, setTypeDeleteState] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {creating ? (
          <form action={recordAction} className="surface space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="record-type">类型</Label>
                <select id="record-type" name="typeId" className={selectClass} required>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="record-date">日期</Label>
                <Input id="record-date" name="date" type="date" defaultValue={todayText} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="record-content">记了什么</Label>
              <textarea
                id="record-content"
                name="content"
                rows={4}
                required
                autoFocus
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">
                涉及的学生（班会这类全班范围的可以不选）
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {students.map((student) => (
                  <label key={student.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="students"
                      value={student.id}
                      className="size-4"
                    />
                    {student.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton label="记录" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                收起
              </Button>
              {recordState.message ? (
                <span className={formMessageClass(recordState.ok)}>{recordState.message}</span>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              新增记录
            </Button>
          </div>
        )}

        {records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
            <InboxTrayArt className="size-12 text-muted-foreground/60" />
            <p className="measure text-sm text-muted-foreground">
              还没有记录。平时最顺手的入口是顶栏的速记：随手记一句，回头在首页收件箱里选「归到学生」。
            </p>
          </div>
        ) : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {records.map((record) => (
              <li key={record.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded border px-1.5 py-0.5">{record.typeName}</span>
                    <span className="tabular-nums">{record.dateText}</span>
                    {record.memberNames.length > 0 ? (
                      <span>{record.memberNames.join("、")}</span>
                    ) : (
                      <span>全班</span>
                    )}
                  </p>
                  <p className="measure text-sm leading-relaxed whitespace-pre-wrap">
                    {record.content}
                  </p>
                </div>
                <form action={deleteStudentRecord.bind(null, record.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="删除这条记录"
                    onClick={(event) => {
                      if (!confirm("删除这条记录？")) event.preventDefault();
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-3">
        {/* 类型是字典表不是自由文本（第 12 条）。起步只有谈话/班会/事件——
            资助、评优这类不建，那是学校平台的词汇表 */}
        <h2 className="px-1 text-sm font-medium">记录类型</h2>
        <form action={typeAction} className="surface space-y-3 p-4">
          <Input name="name" placeholder="谈话 / 班会 / 事件 / 家访…" required />
          <div className="flex items-center gap-2">
            <SubmitButton label="添加" />
            {typeState.message ? (
              <span className={formMessageClass(typeState.ok)}>{typeState.message}</span>
            ) : null}
          </div>
        </form>
        {types.length === 0 ? null : (
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {types.map((type) => (
              <li key={type.id} className="flex items-center gap-2 px-3.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{type.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {type.recordCount} 条记录
                  </p>
                </div>
                <form
                  action={async () => {
                    const result = await deleteRecordType(type.id);
                    setTypeDeleteState(result.ok ? null : (result.message ?? null));
                  }}
                >
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={`删除类型 ${type.name}`}
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {typeDeleteState ? (
          <p className="px-1 text-xs text-destructive">{typeDeleteState}</p>
        ) : null}
      </aside>
    </div>
  );
}
