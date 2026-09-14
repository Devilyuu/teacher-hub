"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { ClipboardArt, FolderArt } from "@/components/empty-art";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import {
  createDutyRecord,
  createDutyType,
  createTeacher,
  deleteDutyRecord,
  deleteDutyType,
  deleteTeacher,
  setTeacherActive,
} from "./actions";

export type DutyTypeRow = {
  id: string;
  name: string;
  note: string | null;
  recordCount: number;
};
export type TeacherRow = {
  id: string;
  name: string;
  active: boolean;
  recordCount: number;
};
export type DutyRecordRow = {
  id: string;
  title: string;
  note: string | null;
  dateText: string;
  typeName: string;
  participants: string[];
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

function Message({ state }: { state: { ok: boolean; message?: string } }) {
  if (!state.message) return null;
  return (
    <span
      className={
        formMessageClass(state.ok)
      }
    >
      {state.message}
    </span>
  );
}

export function DutyPanel({
  types,
  teachers,
  records,
}: {
  types: DutyTypeRow[];
  teachers: TeacherRow[];
  records: DutyRecordRow[];
}) {
  const [creating, setCreating] = useState(false);
  const [recordState, recordAction] = useActionState(
    createDutyRecord,
    IDLE_FORM_STATE,
  );
  const [typeState, typeAction] = useActionState(
    createDutyType,
    IDLE_FORM_STATE,
  );
  const [teacherState, teacherAction] = useActionState(
    createTeacher,
    IDLE_FORM_STATE,
  );

  const activeTeachers = teachers.filter((teacher) => teacher.active);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {types.length === 0 ? (
          // 空状态一律 well 面板 + 单色插画（CLAUDE.md），白卡留给正式内容
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-10 text-center">
            <FolderArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              先在右边建一个轮派类型（监考、校级会议、值班、教学质量优秀…），才能记录。
            </p>
          </div>
        ) : creating ? (
          <form action={recordAction} className="surface space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="title">事项说明</Label>
              <Input
                id="title"
                name="title"
                placeholder="如「期末考试监考 第1场」"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dutyTypeId">类型</Label>
                <select
                  id="dutyTypeId"
                  name="dutyTypeId"
                  className={selectClass}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date">日期</Label>
                <Input id="date" name="date" type="date" required />
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">参与人</legend>
              {activeTeachers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  右边还没有教师，先添加。
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {activeTeachers.map((teacher) => (
                    <label
                      key={teacher.id}
                      className="flex items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="teachers"
                        value={teacher.id}
                        className="size-4"
                      />
                      {teacher.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="note">备注</Label>
              <Input id="note" name="note" />
            </div>

            {/* 默认不建任务：排班表本身就是记录，多数排班不需要变成待办 */}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="generateTasks" className="size-4" />
              同时给每个参与人建一条任务
            </label>

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
              <Message state={recordState} />
            </div>
          </form>
        ) : (
          // 主操作和课题、成果、任务页对齐：右上角、实心、同一个形状
          // （CLAUDE.md：同一个动作在不同页面要长一个样）
          <div className="flex justify-end">
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              新增排班
            </Button>
          </div>
        )}

        {records.length === 0 ? (
          types.length > 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
              <ClipboardArt className="size-12 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">还没有排班记录。</p>
            </div>
          ) : null
        ) : (
          // 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片）
          <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-start gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{record.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded border px-1.5 py-0.5">
                      {record.typeName}
                    </span>
                    <span className="tabular-nums">{record.dateText}</span>
                    <span>{record.participants.join("、")}</span>
                    {record.note ? <span>{record.note}</span> : null}
                  </p>
                </div>
                <ConfirmSubmitButton
                  action={deleteDutyRecord.bind(null, record.id)}
                  message={`删除轮派记录「${record.title}」（${record.dateText}）？删了就找不回来了。`}
                  size="icon-sm"
                  label={`删除 ${record.title}`}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </ConfirmSubmitButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-6">
        {/* 轮派类型是**字典表不是自由文本**（CLAUDE.md 第 12 条）：
            「监考」多打一个字就会被算成两类，没法统计 */}
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-medium">轮派类型</h2>
          <form action={typeAction} className="surface space-y-3 p-4">
            <Input
              name="name"
              placeholder="监考 / 校级会议 / 教学质量优秀…"
              required
            />
            <Input name="note" placeholder="备注（可空）" />
            <div className="flex items-center gap-2">
              <SubmitButton label="添加" />
              <Message state={typeState} />
            </div>
          </form>
          {/* 空字典不渲染：surface 空着会剩一张扁白卡 */}
          {types.length === 0 ? null : (
            <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
              {types.map((type) => (
                <li
                  key={type.id}
                  className="flex items-center gap-2 px-3.5 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{type.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {type.recordCount} 条记录
                    </p>
                  </div>
                  {/* 这是全模块最危险的一个按钮：服务端会连同该类型下的所有记录
                      一起删（deleteDutyType 的事务）。原来点一下就没了，只在悬停
                      提示里写了「连同 N 条记录」——而手机上根本没有悬停 */}
                  <ConfirmSubmitButton
                    action={deleteDutyType.bind(null, type.id)}
                    message={
                      type.recordCount > 0
                        ? `删除类型「${type.name}」会连同它下面的 ${type.recordCount} 条轮派记录一起删掉，找不回来。确定吗？`
                        : `删除类型「${type.name}」？`
                    }
                    size="icon-sm"
                    label={
                      type.recordCount > 0
                        ? `删除类型 ${type.name}（连同 ${type.recordCount} 条记录）`
                        : `删除类型 ${type.name}`
                    }
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </ConfirmSubmitButton>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="px-1 text-sm font-medium">教师名录</h2>
          <form action={teacherAction} className="surface space-y-3 p-4">
            <Input name="name" placeholder="姓名" required />
            <div className="flex items-center gap-2">
              <SubmitButton label="添加" />
              <Message state={teacherState} />
            </div>
          </form>
          {teachers.length === 0 ? null : (
            <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
              {teachers.map((teacher) => (
                <li
                  key={teacher.id}
                  className="flex items-center gap-2 px-3.5 py-1.5"
                >
                  <span
                    className={
                      teacher.active
                        ? "min-w-0 flex-1 text-xs"
                        : "min-w-0 flex-1 text-xs opacity-50"
                    }
                  >
                    {teacher.name}
                    {!teacher.active ? "（不参与轮值）" : ""}
                  </span>
                  <form
                    action={setTeacherActive.bind(
                      null,
                      teacher.id,
                      !teacher.active,
                    )}
                  >
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                    >
                      {teacher.active ? "停用" : "启用"}
                    </Button>
                  </form>
                  {/* 有记录的只停用不删——删了会把历史排班里的人名一并抹掉 */}
                  <form action={deleteTeacher.bind(null, teacher.id)}>
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      title={
                        teacher.recordCount > 0
                          ? "有排班记录，将改为停用"
                          : "删除"
                      }
                      aria-label={`删除 ${teacher.name}`}
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
