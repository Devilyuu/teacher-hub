"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { BookUser, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { createMenteeBatch } from "./actions";
import { BatchPicker, type BatchOption } from "./batch-picker";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "创建中…" : "建批次"}
    </Button>
  );
}

/**
 * 建批次的表单，空状态和页头「新建批次」共用一份。
 * 字段只有这两个——schema 也只收这两个，表单里没有的键写进 schema 就是永远校验失败。
 * 建成后动作直接跳到新批次的名单
 */
function BatchCreateForm({
  defaultYear,
  idPrefix,
  onCancel,
}: {
  defaultYear: number;
  idPrefix: string;
  onCancel?: () => void;
}) {
  const [state, action] = useActionState(createMenteeBatch, IDLE_FORM_STATE);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-3 text-left">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>批次名</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          placeholder="如「2023 级数媒」"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-year`}>入学年份</Label>
        <Input
          id={`${idPrefix}-year`}
          name="year"
          type="number"
          inputMode="numeric"
          defaultValue={defaultYear}
          required
        />
        <p className="text-xs text-muted-foreground">届次排序按它走，不从批次名里猜。</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        {state.message ? (
          <p className={formMessageClass(state.ok)}>{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * 还没有批次时的引导态：一句话 + 建批次表单，建完直接进名单。
 * 导师模块的一切都挂在批次下面，这是唯一的起点。
 */
export function BatchEmptyState({ defaultYear }: { defaultYear: number }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-well p-14 text-center">
      <BookUser className="size-12 text-muted-foreground/60" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">先建一批带教学生</p>
        <p className="measure text-sm text-muted-foreground">
          名单和指导记录都挂在批次下面。双选结果出来后，把名单整块粘过来就行——
          带完这一届把批次归档，记录还查得到。
        </p>
      </div>
      <BatchCreateForm defaultYear={defaultYear} idPrefix="batch" />
    </div>
  );
}

/**
 * 「我的学生」页头右侧：批次切换 + 新建批次。
 *
 * 原来建批次的表单只在一个批次都没有时出现，建完第一批就再没有入口——
 * 而导师学生是按年级成批、几届同时在带的（规格 §1），第二批建不出来这个模块就用不下去。
 * 返回片段而不是包一层：页头是 flex-wrap，展开的表单用 `w-full` 自己占一整行
 */
export function BatchControls({
  options,
  currentId,
  defaultYear,
}: {
  options: BatchOption[];
  currentId: string;
  defaultYear: number;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <BatchPicker options={options} currentId={currentId} />
        {creating ? null : (
          <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            新建批次
          </Button>
        )}
      </div>
      {creating ? (
        <div className="w-full rounded-3xl bg-well p-5">
          <BatchCreateForm
            defaultYear={defaultYear}
            idPrefix="new-batch"
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}
    </>
  );
}
