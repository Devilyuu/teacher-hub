"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDispatchForm } from "@/components/use-dispatch-form";
import {
  deletePerfCategory,
  deletePromotionCategory,
  deleteRuleTable,
  savePerfCategory,
  savePromotionCategory,
  saveRuleGroup,
  saveRulesetHead,
} from "@/lib/actions/rule-actions";
import { formMessageClass, IDLE_FORM_STATE, type FormState } from "@/lib/form-state";
import { formatPerfRules } from "@/lib/perf-rules";
import { cn } from "@/lib/utils";

type RuleTable = "promotion" | "perf";

export type PromotionRow = {
  id: string;
  code: string;
  majorIndicator: string;
  majorCap: number | null;
  minorIndicator: string;
  scoringRule: string | null;
  remark: string | null;
  cap: number | null;
  capGroup: string | null;
  capNote: string | null;
  projectEligible: boolean;
  updatedAt: string;
  achievementCount: number;
  projectCount: number;
};

export type PerfRow = {
  id: string;
  majorCategory: string;
  minorCategory: string;
  baseRule: string | null;
  nationalRule: string | null;
  provincialRule: string | null;
  cityRule: string | null;
  schoolRule: string | null;
  collegeRule: string | null;
  remark: string | null;
  isTeam: boolean;
  isDepartmentAssigned: boolean;
  isActive: boolean;
  projectEligible: boolean;
  updatedAt: string;
  achievementCount: number;
  eventCount: number;
};

const CHIP = "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground whitespace-nowrap";

/**
 * 这一页的表单都不走 form 的 action（useDispatchForm）：走的话动作一跑完 React 就重置表单，
 * 报错时（编号重复之类）人刚填的内容也一起没了。「提交中」由调用方传进来
 */
function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

/** 「添加一项」成功后自己清空，好接着添下一项（编辑表单成功就收起，不用清） */
function useResetOnSuccess(state: FormState, enabled: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (enabled && state.ok) formRef.current?.reset();
  }, [state, enabled]);
  return formRef;
}

function Message({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" aria-live="polite" className={formMessageClass(state.tone ?? state.ok)}>
      {state.message}
    </p>
  );
}

function FieldError({ state, field }: { state: FormState; field: string }) {
  const errors = state.fieldErrors?.[field];
  if (!errors?.length) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {errors[0]}
    </p>
  );
}

/** 保存成功就收起（行内编辑、整组改名）。state 每次提交都是新对象，所以依赖它本身 */
function useCloseOnSuccess(state: FormState, onDone?: () => void) {
  useEffect(() => {
    if (state.ok) onDone?.();
    // onDone 每次渲染都是新函数，只跟着 state 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

// ─── 表单 ───────────────────────────────────────────────────────────

function PromotionCategoryForm({
  year,
  majors,
  row,
  onDone,
}: {
  year: number | null;
  majors: string[];
  row?: PromotionRow;
  onDone?: () => void;
}) {
  const { state, onSubmit, pending } = useDispatchForm(savePromotionCategory, IDLE_FORM_STATE);
  useCloseOnSuccess(state, row ? onDone : undefined);
  const formRef = useResetOnSuccess(state, !row);
  const idPrefix = row ? `promotion-${row.id}` : "promotion-new";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      {year == null ? (
        <div className="max-w-40 space-y-1.5">
          <Label htmlFor={`${idPrefix}-year`}>表的年度</Label>
          <Input id={`${idPrefix}-year`} name="year" type="number" defaultValue={new Date().getFullYear()} />
        </div>
      ) : (
        <input type="hidden" name="year" value={year} />
      )}
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-code`}>编号</Label>
          <Input id={`${idPrefix}-code`} name="code" defaultValue={row?.code ?? ""} placeholder="如 5.2" required />
          <FieldError state={state} field="code" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-major`}>一级指标</Label>
          <Input
            id={`${idPrefix}-major`}
            name="majorIndicator"
            list={`${idPrefix}-majors`}
            defaultValue={row?.majorIndicator ?? ""}
            required
          />
          <datalist id={`${idPrefix}-majors`}>
            {majors.map((major) => (
              <option key={major} value={major} />
            ))}
          </datalist>
          <FieldError state={state} field="majorIndicator" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-minor`}>二级指标</Label>
          <Input id={`${idPrefix}-minor`} name="minorIndicator" defaultValue={row?.minorIndicator ?? ""} required />
          <FieldError state={state} field="minorIndicator" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-rule`}>赋分原文</Label>
          <Textarea
            id={`${idPrefix}-rule`}
            name="scoringRule"
            rows={3}
            defaultValue={row?.scoringRule ?? ""}
            placeholder="照学校的表抄，如「国家级每项6分，省级4分」。系统不解析，只显示给人看"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-remark`}>备注</Label>
          <Textarea id={`${idPrefix}-remark`} name="remark" rows={3} defaultValue={row?.remark ?? ""} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-cap`}>本栏上限</Label>
          <Input
            id={`${idPrefix}-cap`}
            name="cap"
            type="number"
            step="0.1"
            min="0"
            inputMode="decimal"
            defaultValue={row?.cap ?? ""}
            placeholder="不设就空着"
          />
          <FieldError state={state} field="cap" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-group`}>和哪几栏共用上限</Label>
          <Input
            id={`${idPrefix}-group`}
            name="capGroup"
            defaultValue={row && row.capGroup !== row.code ? (row.capGroup ?? "") : ""}
            placeholder="几栏合并封顶时填同一个组名，如「4.5+4.6」；独占就空着"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="projectEligible" defaultChecked={row?.projectEligible ?? false} className="size-4" />
        课题可挂
        <span className="text-xs text-muted-foreground">勾了的会出现在课题表单的职称指标下拉里</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton label={row ? "保存" : "添加"} pending={pending} />
        {onDone && row ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            取消
          </Button>
        ) : null}
        <Message state={state} />
      </div>
    </form>
  );
}

type PerfRuleField = "baseRule" | "nationalRule" | "provincialRule" | "cityRule" | "schoolRule" | "collegeRule";

/** 六格规则里的一格。字段名在调用处写明（表单契约测试靠 `name="…"` 认字段，循环生成的它看不见） */
function PerfRuleInput({
  name,
  label,
  idPrefix,
  row,
}: {
  name: PerfRuleField;
  label: string;
  idPrefix: string;
  row?: PerfRow;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-${name}`}>{label}</Label>
      <Input id={`${idPrefix}-${name}`} name={name} defaultValue={row?.[name] ?? ""} placeholder="不适用就空着" />
    </div>
  );
}

function PerfCategoryForm({
  year,
  majors,
  row,
  onDone,
}: {
  year: number | null;
  majors: string[];
  row?: PerfRow;
  onDone?: () => void;
}) {
  const { state, onSubmit, pending } = useDispatchForm(savePerfCategory, IDLE_FORM_STATE);
  useCloseOnSuccess(state, row ? onDone : undefined);
  const formRef = useResetOnSuccess(state, !row);
  const idPrefix = row ? `perf-${row.id}` : "perf-new";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={row?.id ?? ""} />
      {year == null ? (
        <div className="max-w-40 space-y-1.5">
          <Label htmlFor={`${idPrefix}-year`}>表的年度</Label>
          <Input id={`${idPrefix}-year`} name="year" type="number" defaultValue={new Date().getFullYear()} />
        </div>
      ) : (
        <input type="hidden" name="year" value={year} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-major`}>大类</Label>
          <Input
            id={`${idPrefix}-major`}
            name="majorCategory"
            list={`${idPrefix}-majors`}
            defaultValue={row?.majorCategory ?? ""}
            required
          />
          <datalist id={`${idPrefix}-majors`}>
            {majors.map((major) => (
              <option key={major} value={major} />
            ))}
          </datalist>
          <FieldError state={state} field="majorCategory" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-minor`}>小类</Label>
          <Input id={`${idPrefix}-minor`} name="minorCategory" defaultValue={row?.minorCategory ?? ""} required />
          <FieldError state={state} field="minorCategory" />
        </div>
      </div>
      {/* 六格照学校的表抄，哪格不适用就空着。不解析，只显示给人看 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <PerfRuleInput name="baseRule" label="基本分" idPrefix={idPrefix} row={row} />
        <PerfRuleInput name="nationalRule" label="国家级" idPrefix={idPrefix} row={row} />
        <PerfRuleInput name="provincialRule" label="省级" idPrefix={idPrefix} row={row} />
        <PerfRuleInput name="cityRule" label="市级" idPrefix={idPrefix} row={row} />
        <PerfRuleInput name="schoolRule" label="校级" idPrefix={idPrefix} row={row} />
        <PerfRuleInput name="collegeRule" label="学院级" idPrefix={idPrefix} row={row} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-remark`}>备注</Label>
        <Textarea id={`${idPrefix}-remark`} name="remark" rows={2} defaultValue={row?.remark ?? ""} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isActive" defaultChecked={row?.isActive ?? true} className="size-4" />
          启用
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="projectEligible" defaultChecked={row?.projectEligible ?? false} className="size-4" />
          课题可挂
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isTeam" defaultChecked={row?.isTeam ?? false} className="size-4" />
          团队项目
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isDepartmentAssigned"
            defaultChecked={row?.isDepartmentAssigned ?? false}
            className="size-4"
          />
          学院分配名额
        </label>
      </div>
      <p className="measure text-xs text-muted-foreground">
        停用的不再出现在录入下拉里，已经挂在上面的成果不受影响。今年学校不用这一项了，停用比删除稳妥。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton label={row ? "保存" : "添加"} pending={pending} />
        {onDone && row ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            取消
          </Button>
        ) : null}
        <Message state={state} />
      </div>
    </form>
  );
}

/** 「添加一项」：点开才出现。表还没有时（年度未定）表单里多一格年度 */
export function AddCategory({
  table,
  year,
  majors,
  label,
}: {
  table: RuleTable;
  year: number | null;
  majors: string[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {label}
      </Button>
    );
  }
  return (
    <div className="surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{label}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          收起
        </Button>
      </div>
      {table === "promotion" ? (
        <PromotionCategoryForm year={year} majors={majors} />
      ) : (
        <PerfCategoryForm year={year} majors={majors} />
      )}
    </div>
  );
}

// ─── 整组 ───────────────────────────────────────────────────────────

function GroupEditor({
  table,
  year,
  name,
  majorCap,
  onDone,
}: {
  table: RuleTable;
  year: number;
  name: string;
  majorCap?: number | null;
  onDone: () => void;
}) {
  const { state, onSubmit, pending } = useDispatchForm(saveRuleGroup, IDLE_FORM_STATE);
  useCloseOnSuccess(state, onDone);
  const label = table === "promotion" ? "一级指标" : "大类";
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 border-t border-border/50 px-4 py-3">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="oldName" value={name} />
      <div className="min-w-48 flex-1 space-y-1.5">
        <Label htmlFor={`group-${name}-name`}>{label}名</Label>
        <Input id={`group-${name}-name`} name="newName" defaultValue={name} required />
      </div>
      {table === "promotion" ? (
        <div className="w-32 space-y-1.5">
          <Label htmlFor={`group-${name}-cap`}>一级上限</Label>
          <Input
            id={`group-${name}-cap`}
            name="majorCap"
            type="number"
            step="0.1"
            min="0"
            defaultValue={majorCap ?? ""}
            placeholder="不设就空着"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <SubmitButton label="保存" pending={pending} />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          取消
        </Button>
      </div>
      <div className="basis-full">
        <Message state={state} />
        <p className="measure text-xs text-muted-foreground">
          改名会改这一{table === "promotion" ? "级" : "类"}下的每一项；改成另一个已有的名字就是合并进去。
        </p>
      </div>
    </form>
  );
}

function GroupHeader({
  table,
  year,
  name,
  count,
  majorCap,
}: {
  table: RuleTable;
  year: number;
  name: string;
  count: number;
  majorCap?: number | null;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="bg-well/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <h2 className="text-sm font-medium">{name}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count} 项
          {table === "promotion" ? (majorCap != null ? ` · 一级上限 ${majorCap} 分` : " · 不设一级上限") : ""}
        </span>
        {!editing ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            {table === "promotion" ? "改名 / 上限" : "改名"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <GroupEditor table={table} year={year} name={name} majorCap={majorCap} onDone={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

function groupRows<T>(rows: T[], keyOf: (row: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return [...groups.entries()];
}

function linkedText(parts: Array<[number, string]>): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join("、");
}

// ─── 职称表 ─────────────────────────────────────────────────────────

/**
 * 行内编辑「开着」记的是打开那一刻的数据版本：保存成功、数据刷新后 updatedAt 变了，
 * 表单自然就收起来；保存失败版本不变，表单留着、错误提示也在。
 *
 * 不靠「动作返回 ok 就收起」：保存后整站刷新，新数据和动作结果同一次提交进来，
 * 表单若按版本重挂，收起那一下就赶不上（2026-09-27 实测：存上了，表单却一直开着）
 */
function useRowEditing(version: string) {
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  return {
    editing: openedAt === version,
    open: () => setOpenedAt(version),
    close: () => setOpenedAt(null),
  };
}

function PromotionItem({ row, year, majors }: { row: PromotionRow; year: number; majors: string[] }) {
  const { editing, open, close } = useRowEditing(row.updatedAt);
  const linked = linkedText([
    [row.achievementCount, "条成果"],
    [row.projectCount, "个课题"],
  ]);
  const shared = row.capGroup && row.capGroup !== row.code ? `（与 ${row.capGroup} 共用）` : "";

  return (
    <li className="px-4 py-3">
      {editing ? (
        <PromotionCategoryForm year={year} majors={majors} row={row} onDone={close} />
      ) : (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <span className="w-12 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">{row.code}</span>
          <div className="min-w-0 flex-1 basis-64 space-y-0.5">
            <p className="text-sm font-medium">{row.minorIndicator}</p>
            {row.scoringRule ? (
              <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground" title={row.scoringRule}>
                {row.scoringRule}
              </p>
            ) : null}
            {row.remark ? (
              <p className="line-clamp-1 text-xs text-muted-foreground" title={row.remark}>
                备注：{row.remark}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-xs text-muted-foreground tabular-nums">
              {row.cap != null ? `上限 ${row.cap}${shared}` : "不设上限"}
            </span>
            {row.projectEligible ? <span className={CHIP}>课题可挂</span> : null}
            {linked ? <span className="text-xs text-muted-foreground tabular-nums">挂了 {linked}</span> : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`编辑 ${row.code} ${row.minorIndicator}`}
              title="编辑"
              onClick={open}
            >
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            {/* 硬删：挂着的记录不删、只是分类变空（外键 SetNull），确认框里把条数写清楚 */}
            <ConfirmSubmitButton
              action={deletePromotionCategory.bind(null, row.id)}
              message={
                linked
                  ? `删除「${row.code} ${row.minorIndicator}」？挂在它上面的 ${linked}会变成「不计入职称」（记录本身不删），找不回来。`
                  : `删除「${row.code} ${row.minorIndicator}」？`
              }
              size="icon-sm"
              label={`删除 ${row.code} ${row.minorIndicator}`}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </ConfirmSubmitButton>
          </div>
        </div>
      )}
    </li>
  );
}

export function PromotionTablePanel({ year, rows }: { year: number; rows: PromotionRow[] }) {
  const majors = [...new Set(rows.map((row) => row.majorIndicator))];
  return (
    <div className="space-y-4">
      {groupRows(rows, (row) => row.majorIndicator).map(([major, items]) => (
        <section key={major} className="surface overflow-hidden">
          <GroupHeader table="promotion" year={year} name={major} count={items.length} majorCap={items[0]?.majorCap} />
          <ul className="divide-y divide-border/50">
            {items.map((row) => (
              <PromotionItem key={row.id} row={row} year={year} majors={majors} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── 绩效表 ─────────────────────────────────────────────────────────

function PerfItem({ row, year, majors }: { row: PerfRow; year: number; majors: string[] }) {
  const { editing, open, close } = useRowEditing(row.updatedAt);
  const linked = linkedText([
    [row.achievementCount, "条成果"],
    [row.eventCount, "条课题绩效事项"],
  ]);
  const rules = formatPerfRules(row);

  return (
    <li className={cn("px-4 py-3", !row.isActive && !editing && "opacity-60")}>
      {editing ? (
        <PerfCategoryForm year={year} majors={majors} row={row} onDone={close} />
      ) : (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-64 space-y-0.5">
            <p className="text-sm font-medium">{row.minorCategory}</p>
            {rules ? (
              <p className="line-clamp-2 text-xs text-muted-foreground" title={rules}>
                {rules}
              </p>
            ) : null}
            {row.remark ? (
              <p className="line-clamp-1 text-xs text-muted-foreground" title={row.remark}>
                备注：{row.remark}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {!row.isActive ? <span className={CHIP}>已停用</span> : null}
            {row.projectEligible ? <span className={CHIP}>课题可挂</span> : null}
            {row.isTeam ? <span className={CHIP}>团队项目</span> : null}
            {row.isDepartmentAssigned ? <span className={CHIP}>学院分配名额</span> : null}
            {linked ? <span className="text-xs text-muted-foreground tabular-nums">挂了 {linked}</span> : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`编辑 ${row.minorCategory}`}
              title="编辑"
              onClick={open}
            >
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <ConfirmSubmitButton
              action={deletePerfCategory.bind(null, row.id)}
              message={
                linked
                  ? `删除「${row.majorCategory} / ${row.minorCategory}」？挂在它上面的 ${linked}会变成没有绩效分类（记录本身不删），找不回来。只是今年不用了的话，编辑里取消「启用」更稳妥。`
                  : `删除「${row.majorCategory} / ${row.minorCategory}」？`
              }
              size="icon-sm"
              label={`删除 ${row.minorCategory}`}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </ConfirmSubmitButton>
          </div>
        </div>
      )}
    </li>
  );
}

export function PerfTablePanel({ year, rows }: { year: number; rows: PerfRow[] }) {
  const majors = [...new Set(rows.map((row) => row.majorCategory))];
  return (
    <div className="space-y-4">
      {groupRows(rows, (row) => row.majorCategory).map(([major, items]) => (
        <section key={major} className="surface overflow-hidden">
          <GroupHeader table="perf" year={year} name={major} count={items.length} />
          <ul className="divide-y divide-border/50">
            {items.map((row) => (
              <PerfItem key={row.id} row={row} year={year} majors={majors} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── 表头与整表 ─────────────────────────────────────────────────────

/** 职称表的出处与整表说明。说明里常有几条填分时必须照着看（排名系数、同一成果只算一项） */
export function RulesetHeadEditor({
  year,
  source,
  generalNotes,
  dataVersion,
}: {
  year: number;
  source: string;
  generalNotes: string[];
  dataVersion: string;
}) {
  const { state, onSubmit, pending } = useDispatchForm(saveRulesetHead, IDLE_FORM_STATE);
  return (
    <details className="surface group p-4">
      <summary className="cursor-pointer text-sm font-medium">
        出处与整表说明
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {generalNotes.length > 0 ? `${generalNotes.length} 条说明` : "还没写说明"}
        </span>
      </summary>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div key={dataVersion} className="space-y-3">
          <input type="hidden" name="year" value={year} />
          <div className="space-y-1.5">
            <Label htmlFor="ruleset-source">出处</Label>
            <Input id="ruleset-source" name="source" defaultValue={source} required />
            <FieldError state={state} field="source" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ruleset-notes">整表说明（一行一条）</Label>
            <Textarea
              id="ruleset-notes"
              name="generalNotes"
              rows={6}
              defaultValue={generalNotes.join("\n")}
              placeholder="如：所列成果按任现职以来取得的计算；同一成果适用多个指标时只按一项计分"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton label="保存" pending={pending} />
          <Message state={state} />
        </div>
      </form>
    </details>
  );
}

/** 整张表的这一版一起删：导错了表、导错了年度时的退路。放在最底下，文案把后果说全 */
export function DeleteWholeTable({
  table,
  year,
  label,
  rowCount,
  linkedTotal,
  isCurrent,
}: {
  table: RuleTable;
  year: number;
  label: string;
  rowCount: number;
  linkedTotal: number;
  isCurrent: boolean;
}) {
  const message = [
    `删除「${label}」全部 ${rowCount} 项？`,
    linkedTotal > 0 ? `挂在上面的 ${linkedTotal} 条记录会变成没有分类（记录本身不删）。` : "",
    isCurrent ? "删掉之后录入界面改用更早的一版，一版都没有了就没有下拉。" : "",
    "找不回来。只是导错了某几行的话，逐条删更稳妥。",
  ].join("");
  return (
    <section className="space-y-2 rounded-2xl border border-dashed border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          导错了表或年度？可以把这一版整个删掉重导。
          {linkedTotal > 0 ? `现在有 ${linkedTotal} 条记录挂在这一版上。` : ""}
        </p>
        <ConfirmSubmitButton
          action={deleteRuleTable.bind(null, table, year)}
          message={message}
          className="text-destructive"
          label={`删除${label}`}
        >
          <Trash2 className="size-3.5" aria-hidden />
          删除这一版
        </ConfirmSubmitButton>
      </div>
    </section>
  );
}
