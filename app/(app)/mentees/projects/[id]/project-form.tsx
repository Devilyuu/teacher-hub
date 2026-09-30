"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { updateMenteeProject } from "../../actions";
import { ProjectMemberPicker } from "../member-picker";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}

/**
 * 项目基本信息。
 *
 * **字段区套了一层 `key={dataVersion}`**：非受控表单 + Server Action +
 * 本页 revalidate 会让 Base UI 拿新的 defaultValue 重刷输入框，
 * 库里存对了、界面却显示旧值，看起来就是「保存不了」。
 * key 加在 `<form>` 上会连「已保存」提示一起清掉，所以只包字段区。
 */
export function ProjectForm({
  projectId,
  dataVersion,
  kinds,
  mentees,
  defaults,
}: {
  projectId: string;
  dataVersion: string;
  kinds: Array<{ id: string; name: string }>;
  mentees: Array<{ id: string; name: string }>;
  defaults: {
    title: string;
    kindId: string;
    schoolYear: string;
    outcomeText: string;
    note: string;
    memberIds: string[];
  };
}) {
  const [state, action] = useActionState(
    updateMenteeProject.bind(null, projectId),
    IDLE_FORM_STATE,
  );

  return (
    <form action={action} className="surface space-y-4 p-5">
      <div key={dataVersion} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-title">题目</Label>
          <Input id="edit-title" name="title" defaultValue={defaults.title} required />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-kind">类型</Label>
            <select
              id="edit-kind"
              name="kindId"
              className={selectClass}
              defaultValue={defaults.kindId}
              required
            >
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-year">学年</Label>
            <Input
              id="edit-year"
              name="schoolYear"
              defaultValue={defaults.schoolYear}
              placeholder="2025—2026 学年"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-outcome">结项情况</Label>
            {/* 原文照存照显示，引用为成果时拿它当标题。不设枚举——
                「优秀」「联展入选」「答辩通过」不在一套坐标系的刻度上 */}
            <Input
              id="edit-outcome"
              name="outcomeText"
              defaultValue={defaults.outcomeText}
              placeholder="获评校级优秀毕业设计…"
            />
            <p className="text-xs text-muted-foreground">
              照原样写。填了它，页面顶上会出现「引用为成果」。
            </p>
          </div>
        </div>

        <ProjectMemberPicker mentees={mentees} defaultMemberIds={defaults.memberIds} />

        <div className="space-y-1.5">
          <Label htmlFor="edit-note">备注</Label>
          <Input id="edit-note" name="note" defaultValue={defaults.note} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        {state.message ? (
          <span className={formMessageClass(state.ok)}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
