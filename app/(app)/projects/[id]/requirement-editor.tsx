"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { DateField, TextAreaField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, type FormState, formMessageClass } from "@/lib/form-state";
import { ACHIEVEMENT_TYPE_LABELS } from "@/lib/labels";
import { linkableAchievementTypeOptions } from "@/lib/options";
import { createRequirement, deleteRequirement, updateRequirement } from "./requirement-actions";
import type { AchievementType, FundingType } from "@/lib/generated/prisma/enums";

/** constraints 里最常用的几项，勾一下就往 JSON 里填（BUILD_PLAN Phase 1） */
const QUICK_CONSTRAINTS: Array<{ key: string; label: string; value: unknown }> = [
  { key: "authorPosition", label: "须第一作者", value: 1 },
  { key: "indexedBy", label: "知网收录", value: "CNKI" },
  { key: "journalLevel", label: "省级期刊", value: "省级" },
  { key: "minWords", label: "≥1 万字", value: 10000 },
  { key: "maxDupRate", label: "查重 ≤20%", value: 20 },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

export type RequirementDefaults = {
  rawText: string;
  allowedTypes: AchievementType[];
  requiredCount: number;
  dueDate: Date | null;
  constraints: unknown;
};

function RequirementFields({
  defaults,
  fundingType,
  state,
}: {
  defaults?: RequirementDefaults;
  /** 课题的纵向 / 横向。到账经费只对横向放出来（设计 §界面） */
  fundingType: FundingType;
  state: FormState;
}) {
  const errorsOf = (field: string) => state.fieldErrors?.[field];

  const [types, setTypes] = useState<string[]>(defaults?.allowedTypes ?? []);
  const typeOptions = linkableAchievementTypeOptions(fundingType);

  // 已经存着、但现在选不了的类型（课题从横向改成纵向，或存量导进来的老类型）
  // 也要摆出来——按钮不渲染就没法取消勾选，那条要求会永远存不下去
  const staleOptions = types
    .filter((type) => !typeOptions.some((option) => option.value === type))
    .map((type) => ({ value: type, label: ACHIEVEMENT_TYPE_LABELS[type as AchievementType] }));
  const [constraints, setConstraints] = useState(
    JSON.stringify(defaults?.constraints ?? {}, null, 2),
  );

  function applyQuick(key: string, value: unknown) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(constraints || "{}") as Record<string, unknown>;
    } catch {
      // JSON 已经写坏了就别再自动改，免得把用户写了一半的内容冲掉
      return;
    }
    if (key in parsed) delete parsed[key];
    else parsed[key] = value;
    setConstraints(JSON.stringify(parsed, null, 2));
  }

  return (
    <div className="space-y-4">
      <TextAreaField
        name="rawText"
        label="立项文件原文"
        required
        rows={4}
        defaultValue={defaults?.rawText}
        hint="照抄，别概括。结构化不了的要求靠这段话兜底，它才是结题时的依据"
        errors={errorsOf("rawText")}
      />

      <div className="space-y-1.5">
        <Label>可接受的成果类型</Label>
        <input type="hidden" name="allowedTypes" value={types.join(",")} />
        <div className="flex flex-wrap gap-1.5">
          {[...typeOptions, ...staleOptions].map((option) => {
            const active = types.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setTypes((prev) =>
                    active ? prev.filter((t) => t !== option.value) : [...prev, option.value],
                  )
                }
                className={
                  active
                    ? "rounded border border-foreground/30 bg-accent px-2 py-1 text-xs"
                    : "rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          一个都不选 = 不限类型。选多个表示「任选其一」，如「论文或教材合计 2 项」
          {fundingType === "HORIZONTAL"
            ? "。横向项目可以把「到账经费」写成结题条件"
            : ""}
        </p>
        {errorsOf("allowedTypes")?.map((error) => (
          <p key={error} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="requiredCount"
          label="数量"
          type="number"
          defaultValue={(defaults?.requiredCount ?? 1).toString()}
          errors={errorsOf("requiredCount")}
        />
        <DateField
          name="dueDate"
          label="该项单独的截止日"
          defaultValue={defaults?.dueDate}
          hint="有的成果要先交，不填则跟课题走"
          errors={errorsOf("dueDate")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="constraints">可机器校验的约束</Label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CONSTRAINTS.map((quick) => (
            <button
              key={quick.key}
              type="button"
              onClick={() => applyQuick(quick.key, quick.value)}
              className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50"
            >
              + {quick.label}
            </button>
          ))}
        </div>
        <textarea
          id="constraints"
          name="constraints"
          rows={7}
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          spellCheck={false}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          只放能被机器比对的部分。没法结构化的写进 <code>extra</code> 数组，挂接时会列出来提醒人工核对
        </p>
        {errorsOf("constraints")?.map((error) => (
          <p key={error} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ))}
      </div>

      {state.message ? (
        <p className={formMessageClass(state.ok, "sm")}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function AddRequirement({
  projectId,
  fundingType,
}: {
  projectId: string;
  fundingType: FundingType;
}) {
  const [open, setOpen] = useState(false);
  const action = createRequirement.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        添加结题要求项
      </Button>
    );
  }

  return (
    <form action={formAction} className="surface space-y-4 p-4">
      <h3 className="text-sm font-medium">新增结题要求项</h3>
      <RequirementFields fundingType={fundingType} state={state} />
      <div className="flex gap-2">
        <SubmitButton label="添加" />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  );
}

export function EditRequirement({
  requirementId,
  projectId,
  fundingType,
  defaults,
}: {
  requirementId: string;
  projectId: string;
  fundingType: FundingType;
  defaults: RequirementDefaults;
}) {
  const [open, setOpen] = useState(false);
  const action = updateRequirement.bind(null, requirementId, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);
  const remove = deleteRequirement.bind(null, requirementId, projectId);

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-3.5" aria-hidden />
        编辑
      </Button>
    );
  }

  return (
    <div className="w-full space-y-4 rounded border bg-muted/30 p-4">
      <form action={formAction} className="space-y-4">
        <h3 className="text-sm font-medium">编辑结题要求项</h3>
        <RequirementFields defaults={defaults} fundingType={fundingType} state={state} />
        <div className="flex gap-2">
          <SubmitButton label="保存" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            收起
          </Button>
        </div>
      </form>

      <form
        action={remove}
        onSubmit={(e) => {
          // 删要求项会连带删掉它下面的全部挂接，问一句
          if (!confirm("删除这条要求项？它下面的挂接记录会一起消失。")) e.preventDefault();
        }}
      >
        <Button type="submit" variant="ghost" size="sm" className="h-7 text-destructive">
          <Trash2 className="size-3.5" aria-hidden />
          删除这条要求项
        </Button>
      </form>
    </div>
  );
}

export { ACHIEVEMENT_TYPE_LABELS };
