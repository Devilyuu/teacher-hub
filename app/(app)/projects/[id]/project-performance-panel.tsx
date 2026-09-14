"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import type { ProjectPerformanceEventKind } from "@/lib/generated/prisma/enums";
import {
  PROJECT_PERFORMANCE_EVENT_LABELS,
  defaultEventYear,
  ruleColumnsForEvent,
  toWan,
  type ProjectPerformanceSource,
  type RuleColumn,
} from "@/lib/project-performance";
import {
  createProjectPerformanceEvent,
  deleteProjectPerformanceEvent,
} from "./project-performance-actions";

type ProjectPerformanceRule = {
  id: string;
  year: number;
  majorCategory: string;
  minorCategory: string;
  baseRule: string | null;
  nationalRule: string | null;
  provincialRule: string | null;
  cityRule: string | null;
  schoolRule: string | null;
  collegeRule: string | null;
  remark: string | null;
};

type ProjectPerformanceEventItem = {
  id: string;
  kind: ProjectPerformanceEventKind;
  year: number;
  perfCategory: {
    year: number;
    majorCategory: string;
    minorCategory: string;
  } | null;
  declaredScore: string | null;
  isVerified: boolean;
  legacyAchievementId: string | null;
};

const EVENT_KINDS: ProjectPerformanceEventKind[] = [
  "APPLY",
  "APPROVED",
  "FUNDING",
  "CLOSEOUT",
  "OTHER",
];

const RULE_COLUMN_LABELS: Record<RuleColumn, string> = {
  base: "基本分",
  national: "国家级",
  provincial: "省级",
  city: "市级 / 区级",
  school: "校级",
  college: "院级",
};

function ruleText(rule: ProjectPerformanceRule, column: RuleColumn): string | null {
  switch (column) {
    case "base":
      return rule.baseRule;
    case "national":
      return rule.nationalRule;
    case "provincial":
      return rule.provincialRule;
    case "city":
      return rule.cityRule;
    case "school":
      return rule.schoolRule;
    case "college":
      return rule.collegeRule;
  }
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "添加中…" : "添加绩效事项"}
    </Button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-muted-foreground"
    >
      <Trash2 className="size-3.5" aria-hidden />
      {pending ? "删除中…" : "删除"}
    </Button>
  );
}

function DeleteEventControl({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    deleteProjectPerformanceEvent,
    IDLE_FORM_STATE,
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!confirm("确定删除这条课题绩效事项？")) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <DeleteButton />
      </form>
      {state.message ? (
        <span
          role="status"
          aria-live="polite"
          className={state.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

export function ProjectPerformancePanel({
  projectId,
  project,
  rules,
  suggestedKind,
  fallbackYear,
  events,
}: {
  projectId: string;
  project: ProjectPerformanceSource;
  rules: ProjectPerformanceRule[];
  suggestedKind: ProjectPerformanceEventKind;
  fallbackYear: number;
  events: ProjectPerformanceEventItem[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ProjectPerformanceEventKind>(suggestedKind);
  const [year, setYear] = useState(
    String(defaultEventYear(project, suggestedKind, fallbackYear)),
  );
  const [ruleId, setRuleId] = useState("");
  const action = createProjectPerformanceEvent.bind(null, projectId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  const selectedRule = rules.find((rule) => rule.id === ruleId);
  const columns = ruleColumnsForEvent(project, kind);
  const fundingWan = toWan(project.fundingReceived);
  const yearError = state.fieldErrors?.year?.[0];
  const categoryError = state.fieldErrors?.perfCategoryId?.[0];
  const scoreError = state.fieldErrors?.declaredScore?.[0];

  return (
    <section className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">课题绩效事项</h2>
          <p className="text-xs text-muted-foreground">
            记录课题申报、立项、到账、结题等年度绩效事实；分值由人对照规则填写。
          </p>
        </div>
        {!open && rules.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            添加绩效事项
          </Button>
        ) : null}
      </div>

      {events.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {events.map((event) => (
            <li key={event.id} className="grid gap-3 py-3 first:pt-0 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {PROJECT_PERFORMANCE_EVENT_LABELS[event.kind]}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{event.year} 年</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {event.isVerified ? "已核实" : "待核实"}
                  </span>
                  <span className="tabular-nums">
                    {event.declaredScore == null ? "未填分" : `${event.declaredScore} 分`}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {event.perfCategory
                    ? `${event.perfCategory.majorCategory} / ${event.perfCategory.minorCategory}（${event.perfCategory.year}）`
                    : "未挂绩效分类"}
                </p>
                {event.legacyAchievementId ? (
                  <p className="text-xs text-muted-foreground">
                    由历史记录迁移形成，不可在这里直接删除。
                  </p>
                ) : null}
              </div>
              {event.legacyAchievementId ? null : <DeleteEventControl id={event.id} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">尚未记录课题绩效事项。</p>
      )}

      {rules.length === 0 ? (
        <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          当前年度没有可用的课题绩效分类，暂时不能添加新事项。
        </p>
      ) : null}

      {open ? (
        <form action={formAction} className="space-y-4 border-t border-border/60 pt-4">
          <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">事项类型</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="事项类型">
              {EVENT_KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                    setYear(String(defaultEventYear(project, value, fallbackYear)));
                  }}
                  className={
                    kind === value
                      ? "rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      : "rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  }
                >
                  {PROJECT_PERFORMANCE_EVENT_LABELS[value]}
                  {value === suggestedKind ? "（建议）" : ""}
                </button>
              ))}
            </div>
            <input type="hidden" name="kind" value={kind} />
          </div>

          <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <label htmlFor="project-performance-year" className="text-xs text-muted-foreground">
                绩效年度
              </label>
              <input
                id="project-performance-year"
                name="year"
                type="number"
                min={2000}
                max={2100}
                step={1}
                value={year}
                onChange={(event) => setYear(event.target.value)}
                aria-invalid={yearError ? true : undefined}
                aria-describedby={
                  yearError ? "project-performance-year-error" : undefined
                }
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {yearError ? (
                <p id="project-performance-year-error" className="text-xs text-destructive">
                  {yearError}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="project-performance-category"
                className="text-xs text-muted-foreground"
              >
                绩效小类
              </label>
              <select
                id="project-performance-category"
                name="perfCategoryId"
                value={ruleId}
                onChange={(event) => setRuleId(event.target.value)}
                required
                aria-invalid={categoryError ? true : undefined}
                aria-describedby={
                  categoryError ? "project-performance-category-error" : undefined
                }
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="" disabled>
                  请选择绩效小类
                </option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.majorCategory} / {rule.minorCategory}
                  </option>
                ))}
              </select>
              {categoryError ? (
                <p
                  id="project-performance-category-error"
                  className="text-xs text-destructive"
                >
                  {categoryError}
                </p>
              ) : null}
            </div>
          </div>

          {selectedRule ? (
            <div className="space-y-2 rounded-xl bg-muted/50 p-3">
              <div>
                <p className="text-xs font-medium">赋分规则（原文）</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedRule.year} 年 · {selectedRule.majorCategory} /{" "}
                  {selectedRule.minorCategory}
                </p>
              </div>
              <dl className="space-y-1 text-xs text-muted-foreground">
                {columns.map((column) => (
                  <div key={column} className="flex gap-2">
                    <dt className="w-16 shrink-0">{RULE_COLUMN_LABELS[column]}</dt>
                    <dd className="whitespace-pre-wrap">
                      {ruleText(selectedRule, column) ?? "——"}
                    </dd>
                  </div>
                ))}
              </dl>
              {selectedRule.remark ? (
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                  说明：{selectedRule.remark}
                </p>
              ) : null}
              {columns.length > 1 ? (
                <p className="text-xs text-muted-foreground">基本分与级别分相加。</p>
              ) : null}
              {kind === "FUNDING" && fundingWan > 0 ? (
                <p className="text-xs text-muted-foreground">
                  本课题已到账{" "}
                  <span className="tabular-nums">{fundingWan.toFixed(1)}</span> 万元
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="project-performance-score" className="text-xs text-muted-foreground">
              申报分（可留空）
            </label>
            <input
              id="project-performance-score"
              name="declaredScore"
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="—"
              aria-invalid={scoreError ? true : undefined}
              aria-describedby={
                scoreError ? "project-performance-score-error" : undefined
              }
              className="h-9 w-28 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {scoreError ? (
              <p id="project-performance-score-error" className="text-xs text-destructive">
                {scoreError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <CreateButton />
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              收起
            </Button>
            {state.message ? (
              <span
                role="status"
                aria-live="polite"
                className={
                  state.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"
                }
              >
                {state.message}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
