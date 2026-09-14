"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formMessageClass,
  IDLE_FORM_STATE,
  type FormState,
} from "@/lib/form-state";
import { LEVEL_LABELS } from "@/lib/labels";

export type HonorFormDefaults = {
  title: string;
  level: string;
  issuer: string | null;
  awardedAt: string | null;
  dateText: string | null;
  note: string | null;
  isCollective: boolean;
  memberIds: string[];
};

const EMPTY_DEFAULTS: HonorFormDefaults = {
  title: "",
  level: "UNRATED",
  issuer: null,
  awardedAt: null,
  dateText: null,
  note: null,
  isCollective: false,
  memberIds: [],
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

/** 创建与编辑共用。列表页传空 defaults，详情页传库里的值 + dataVersion */
export function HonorForm({
  action,
  students,
  defaults = EMPTY_DEFAULTS,
  dataVersion,
  submitLabel,
  onCancel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  students: Array<{ id: string; name: string }>;
  defaults?: HonorFormDefaults;
  dataVersion?: string;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const [collective, setCollective] = useState(defaults.isCollective);
  const memberSet = new Set(defaults.memberIds);

  return (
    <form action={formAction} className="surface space-y-4 p-5">
      <div key={dataVersion} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="honor-title">荣誉名称</Label>
            <Input
              id="honor-title"
              name="title"
              placeholder="如「全国职业院校技能大赛一等奖」"
              required
              defaultValue={defaults.title}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="honor-level">级别</Label>
            <select
              id="honor-level"
              name="level"
              className={selectClass}
              defaultValue={defaults.level}
            >
              {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="honor-issuer">颁发单位</Label>
            <Input id="honor-issuer" name="issuer" defaultValue={defaults.issuer ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="honor-awarded">获奖日（精确到日才填）</Label>
            <Input
              id="honor-awarded"
              name="awardedAt"
              type="date"
              defaultValue={defaults.awardedAt ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="honor-datetext">时间原文</Label>
            <Input
              id="honor-datetext"
              name="dateText"
              placeholder="奖状上只有「2025年6月」就照抄在这"
              defaultValue={defaults.dateText ?? ""}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isCollective"
            className="size-4"
            checked={collective}
            onChange={(event) => setCollective(event.target.checked)}
          />
          集体荣誉（先进班集体这类，归属班级、不挂具体学生）
        </label>

        {collective ? null : (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">获奖学生（团体赛可以多选）</legend>
            {students.length === 0 ? (
              <p className="text-xs text-muted-foreground">名册还是空的，先去导入学生。</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {students.map((student) => (
                  <label key={student.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="students"
                      value={student.id}
                      className="size-4"
                      defaultChecked={memberSet.has(student.id)}
                    />
                    {student.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="honor-note">备注</Label>
          <Input id="honor-note" name="note" defaultValue={defaults.note ?? ""} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={submitLabel} />
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            收起
          </Button>
        ) : null}
        {state.message ? (
          <span className={formMessageClass(state.ok)}>{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}
