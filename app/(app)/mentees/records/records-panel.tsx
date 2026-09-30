"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { InboxTrayArt } from "@/components/empty-art";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { RecordProjectPicker } from "./record-project-picker";
import {
  createMenteeRecord,
  createMenteeRecordType,
  deleteMenteeRecord,
  deleteMenteeRecordType,
} from "../actions";

export type MenteeRecordTypeRow = {
  id: string;
  name: string;
  recordCount: number;
};

export type MenteeRecordRow = {
  id: string;
  dateText: string;
  typeName: string;
  memberNames: string[];
  content: string;
  /** 挂在哪个项目上；null = 没挂（学业、生涯那些谈话本来就不挂） */
  projectId: string | null;
};

export type RecordProjectOption = { id: string; title: string };

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

export function MenteeRecordsPanel({
  batchId,
  types,
  mentees,
  projects,
  records,
  todayText,
  filtered,
}: {
  batchId: string;
  types: MenteeRecordTypeRow[];
  mentees: Array<{ id: string; name: string }>;
  projects: RecordProjectOption[];
  records: MenteeRecordRow[];
  todayText: string;
  /** 当前列表是否被筛选过——空列表的文案得分清「没记过」和「这个条件下没有」 */
  filtered: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [recordState, recordAction] = useActionState(
    createMenteeRecord.bind(null, batchId),
    IDLE_FORM_STATE,
  );
  const [typeState, typeAction] = useActionState(
    createMenteeRecordType,
    IDLE_FORM_STATE,
  );
  const [typeDeleteState, setTypeDeleteState] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {creating ? (
          <form action={recordAction} className="surface space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mentee-record-type">类型</Label>
                <select
                  id="mentee-record-type"
                  name="typeId"
                  className={selectClass}
                  required
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mentee-record-date">日期</Label>
                <Input
                  id="mentee-record-date"
                  name="date"
                  type="date"
                  defaultValue={todayText}
                  required
                />
              </div>
            </div>

            {projects.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="mentee-record-project">围绕哪个项目（可不选）</Label>
                {/* 挂上了，答辩季那张「一人一张的毕设指导记录表」才筛得出内容；
                    学业、生涯那些谈话本来就不挂，所以默认是「不挂项目」 */}
                <select id="mentee-record-project" name="projectId" className={selectClass}>
                  <option value="">不挂项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="mentee-record-content">谈了什么</Label>
              <textarea
                id="mentee-record-content"
                name="content"
                rows={4}
                required
                autoFocus
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">
                涉及的学生（集体见面会这类可以不选）
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {mentees.map((mentee) => (
                  <label key={mentee.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="mentees"
                      value={mentee.id}
                      className="size-4"
                    />
                    {mentee.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton label="记录" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreating(false)}
              >
                收起
              </Button>
              {recordState.message ? (
                <span className={formMessageClass(recordState.ok)}>
                  {recordState.message}
                </span>
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
              {filtered
                ? "这个筛选条件下没有记录。把条件放宽一点试试。"
                : "还没有记录。平时最顺手的入口是顶栏的速记：随手记一句，回头在首页收件箱里选「归到导师学生」。"}
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
                      <span>全批</span>
                    )}
                    <RecordProjectPicker
                      recordId={record.id}
                      projectId={record.projectId}
                      projects={projects}
                    />
                  </p>
                  <p className="measure text-sm leading-relaxed whitespace-pre-wrap">
                    {record.content}
                  </p>
                </div>
                <ConfirmSubmitButton
                  action={deleteMenteeRecord.bind(null, record.id)}
                  message="删除这条指导记录？找不回来。"
                  size="icon-sm"
                  label="删除这条记录"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-3">
        {/* 类型是字典表不是自由文本（第 12 条）。起步只有见面/学业指导/毕设指导/
            生涯规划——资助、评优这类不建，那是学校平台的词汇表 */}
        <h2 className="px-1 text-sm font-medium">记录类型</h2>
        <form action={typeAction} className="surface space-y-3 p-4">
          <Input name="name" placeholder="见面 / 学业指导 / 毕设指导…" required />
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
                {/* 字典项硬删，走确认；还有记录挂着时服务端会拒绝并给出人话 */}
                <ConfirmSubmitButton
                  action={async () => {
                    const result = await deleteMenteeRecordType(type.id);
                    setTypeDeleteState(result.ok ? null : (result.message ?? null));
                  }}
                  message={
                    type.recordCount > 0
                      ? `「${type.name}」下还有 ${type.recordCount} 条记录，删不掉；确定要试吗？`
                      : `删除类型「${type.name}」？删掉就没有了。`
                  }
                  size="icon-sm"
                  label={`删除类型 ${type.name}`}
                >
                  <Trash2 className="size-3" aria-hidden />
                </ConfirmSubmitButton>
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
