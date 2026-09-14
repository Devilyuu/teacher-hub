"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { ClearCalendarArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import {
  RECURRING_FREQ_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_SOURCE_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/labels";
import { describeRule } from "@/lib/recurring";
import { createRecurringRule, deleteRecurringRule, toggleRecurringRule } from "../actions";
import type { ProjectOption } from "../task-form";
import type { RecurringFreq, TaskPriority, TaskSource } from "@/lib/generated/prisma/enums";

export type RuleRow = {
  id: string;
  title: string;
  freq: RecurringFreq;
  day: number;
  active: boolean;
  source: TaskSource;
  priority: TaskPriority;
  note: string | null;
  lastRunYmd: string | null;
  relatedProject: { id: string; title: string; shortTitle: string | null } | null;
};

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : "新建规则"}
    </Button>
  );
}

export function RecurringPanel({
  rules,
  projects,
}: {
  rules: RuleRow[];
  projects: ProjectOption[];
}) {
  const [open, setOpen] = useState(false);
  const [freq, setFreq] = useState<RecurringFreq>("WEEKLY");
  const [state, formAction] = useActionState(createRecurringRule, IDLE_FORM_STATE);

  return (
    <div className="space-y-5">
      {open ? (
        <form action={formAction} className="surface space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="title">任务内容</Label>
            <Input
              id="title"
              name="title"
              placeholder="如「填报周报」"
              required
              aria-invalid={state.fieldErrors?.title ? true : undefined}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="freq">周期</Label>
              <select
                id="freq"
                name="freq"
                value={freq}
                onChange={(e) => setFreq(e.target.value as RecurringFreq)}
                className={selectClass}
              >
                {Object.entries(RECURRING_FREQ_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="day">{freq === "WEEKLY" ? "星期几" : "几号"}</Label>
              {/* 每周只有 7 天，所以这里跟着周期换选项——
                  填了 8 的话规则永远不触发，而静默失效最难查 */}
              <select id="day" name="day" className={selectClass} defaultValue="1">
                {freq === "WEEKLY"
                  ? Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))
                  : Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {day} 号
                      </option>
                    ))}
              </select>
              {freq === "MONTHLY" ? (
                <p className="text-xs text-muted-foreground">超出当月天数时落在月末</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="source">来源</Label>
              <select id="source" name="source" defaultValue="SELF" className={selectClass}>
                {Object.entries(TASK_SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="priority">优先级</Label>
              <select id="priority" name="priority" defaultValue="NORMAL" className={selectClass}>
                {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relatedProjectId">关联课题</Label>
            <select id="relatedProjectId" name="relatedProjectId" defaultValue="" className={selectClass}>
              <option value="">不关联</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.shortTitle ?? project.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">备注</Label>
            <Input id="note" name="note" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton />
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              收起
            </Button>
            {state.message ? (
              <span
                className={
                  formMessageClass(state.ok)
                }
              >
                {state.message}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        // 主操作和课题、成果、任务页对齐：右上角、实心、同一个形状
        // （CLAUDE.md：同一个动作在不同页面要长一个样）
        <div className="flex justify-end">
          <Button type="button" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            新建规则
          </Button>
        </div>
      )}

      {/* 空状态一律 well 面板 + 单色插画（CLAUDE.md），白卡留给正式内容 */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-12 text-center">
          <ClearCalendarArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            还没有周期规则。「每周一填周报」「每月 25 号交考勤」这类反复出现的事，
            设成规则就不用每次自己记。
          </p>
        </div>
      ) : (
        // 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片）
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className={rule.active ? "text-sm" : "text-sm text-muted-foreground"}>
                  {rule.title}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{describeRule(rule)}</span>
                  <span>{TASK_SOURCE_LABELS[rule.source]}</span>
                  {rule.relatedProject ? (
                    <span>挂：{rule.relatedProject.shortTitle ?? rule.relatedProject.title}</span>
                  ) : null}
                  <span>
                    {rule.lastRunYmd ? `上次生成 ${rule.lastRunYmd}` : "还没生成过"}
                  </span>
                  {!rule.active ? <span>已停用</span> : null}
                </p>
              </div>

              <form action={toggleRecurringRule.bind(null, rule.id, !rule.active)}>
                <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                  {rule.active ? "停用" : "启用"}
                </Button>
              </form>

              {/* 已经生成出去的任务不跟着删——它们是独立的待办 */}
              <form action={deleteRecurringRule.bind(null, rule.id)}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  title="删除规则"
                  aria-label={`删除规则 ${rule.title}`}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
