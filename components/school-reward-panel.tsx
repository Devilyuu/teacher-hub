"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import {
  createSchoolRewardDecision,
  deleteSchoolRewardDecision,
  type RewardTarget,
} from "@/app/(app)/school-reward-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import type { SchoolRewardDomain } from "@/lib/generated/prisma/enums";
import {
  SCHOOL_REWARD_DOMAIN_LABELS,
  SCHOOL_REWARD_DOMAIN_OPTIONS,
} from "@/lib/school-rewards";

export type SchoolRewardDecisionItem = {
  id: string;
  approvedAt: Date;
  batch: string | null;
  domain: SchoolRewardDomain;
  awardItem: string;
  awardLevel: string | null;
  awardAmountYuan: string | null;
  evidenceRef: string | null;
  note: string | null;
};

function FieldError({
  id,
  errors,
}: {
  id: string;
  errors?: string[];
}) {
  if (!errors?.length) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {errors[0]}
    </p>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "记录中…" : "记录审定通过"}
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
      {pending ? "删除中…" : "删除误录"}
    </Button>
  );
}

function DeleteRewardControl({ id }: { id: string }) {
  const [state, formAction] = useActionState(
    () => deleteSchoolRewardDecision(id),
    IDLE_FORM_STATE,
  );

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !confirm(
              "只应删除误录的审定记录。确定删除？若这是最后一条，当前对象将不再因学校奖励被排除。",
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <DeleteButton />
      </form>
      {state.message ? (
        <span
          role="status"
          aria-live="polite"
          className={
            state.ok
              ? "text-xs text-muted-foreground"
              : "text-xs text-destructive"
          }
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

function formatAwardAmount(value: string | null): string | null {
  if (value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元`
    : `${value} 元`;
}

export function SchoolRewardPanel({
  target,
  decisions,
}: {
  target: RewardTarget;
  decisions: SchoolRewardDecisionItem[];
}) {
  const [open, setOpen] = useState(false);
  const action = createSchoolRewardDecision.bind(null, target);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  return (
    <section className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">学校突出成果奖励</h2>
          <p className="text-xs text-muted-foreground">
            这里只记录学校已经正式审定通过的事实，不从成果类型、课题级别或奖励办法自动推断。
          </p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-3.5" aria-hidden />
            添加审定记录
          </Button>
        ) : null}
      </div>

      {decisions.length > 0 ? (
        <>
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm font-medium">
            审定通过 · 永久排除学院绩效，不影响职称
          </p>
          <p className="text-xs text-muted-foreground">
            排除只作用于当前对象，不向课题产出或所属课题级联。升级奖励或补差请追加一条审定记录。
          </p>
          <ul className="divide-y divide-border/60">
            {decisions.map((decision) => {
              const amount = formatAwardAmount(decision.awardAmountYuan);
              return (
                <li
                  key={decision.id}
                  className="grid gap-3 py-3 first:pt-0 sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{decision.awardItem}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        审定通过
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {SCHOOL_REWARD_DOMAIN_LABELS[decision.domain]} ·{" "}
                      {formatDate(decision.approvedAt)}
                      {decision.awardLevel ? ` · ${decision.awardLevel}` : ""}
                      {amount ? ` · ${amount}` : ""}
                    </p>
                    {decision.batch ? (
                      <p className="text-xs text-muted-foreground">
                        批次：{decision.batch}
                      </p>
                    ) : null}
                    {decision.evidenceRef ? (
                      <p className="text-xs break-words text-muted-foreground">
                        依据：{decision.evidenceRef}
                      </p>
                    ) : null}
                    {decision.note ? (
                      <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                        备注：{decision.note}
                      </p>
                    ) : null}
                  </div>
                  <DeleteRewardControl id={decision.id} />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          尚未记录正式审定。没有记录时，该对象仍按原规则参加学院绩效和职称评审。
        </p>
      )}

      {open ? (
        <form
          key={`${decisions.length}-${state.ok}`}
          action={formAction}
          className="space-y-4 border-t border-border/60 pt-4"
        >
          <p className="text-xs font-medium">
            录入的是已审定结果，不是申请中或待审批状态。
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="school-reward-approved-at">审定通过日期</Label>
              <Input
                id="school-reward-approved-at"
                name="approvedAt"
                type="date"
                required
                aria-invalid={
                  state.fieldErrors?.approvedAt ? true : undefined
                }
                aria-describedby={
                  state.fieldErrors?.approvedAt
                    ? "school-reward-approved-at-error"
                    : undefined
                }
              />
              <FieldError
                id="school-reward-approved-at-error"
                errors={state.fieldErrors?.approvedAt}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="school-reward-domain">奖励领域</Label>
              <select
                id="school-reward-domain"
                name="domain"
                defaultValue="RESEARCH"
                required
                aria-invalid={state.fieldErrors?.domain ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.domain
                    ? "school-reward-domain-error"
                    : undefined
                }
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              >
                {SCHOOL_REWARD_DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <FieldError
                id="school-reward-domain-error"
                errors={state.fieldErrors?.domain}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="school-reward-item">奖励项目</Label>
            <Input
              id="school-reward-item"
              name="awardItem"
              required
              placeholder="按审定文件原文填写"
              aria-invalid={state.fieldErrors?.awardItem ? true : undefined}
              aria-describedby={
                state.fieldErrors?.awardItem
                  ? "school-reward-item-error"
                  : undefined
              }
            />
            <FieldError
              id="school-reward-item-error"
              errors={state.fieldErrors?.awardItem}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="school-reward-level">奖励等级</Label>
              <Input
                id="school-reward-level"
                name="awardLevel"
                placeholder="如 一等奖、省级"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-reward-amount">奖励金额（元）</Label>
              <Input
                id="school-reward-amount"
                name="awardAmountYuan"
                type="number"
                min="0"
                max="9999999999.99"
                step="0.01"
                inputMode="decimal"
                aria-invalid={
                  state.fieldErrors?.awardAmountYuan ? true : undefined
                }
                aria-describedby={
                  state.fieldErrors?.awardAmountYuan
                    ? "school-reward-amount-error"
                    : undefined
                }
              />
              <FieldError
                id="school-reward-amount-error"
                errors={state.fieldErrors?.awardAmountYuan}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="school-reward-batch">批次</Label>
              <Input
                id="school-reward-batch"
                name="batch"
                placeholder="如 2026 年第一批"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-reward-evidence">审定依据</Label>
              <Input
                id="school-reward-evidence"
                name="evidenceRef"
                placeholder="文件号、会议纪要或凭证"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="school-reward-note">备注</Label>
            <Textarea
              id="school-reward-note"
              name="note"
              rows={2}
              placeholder="补差、发放说明等"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SaveButton />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              收起
            </Button>
            {state.message ? (
              <span
                role="status"
                aria-live="polite"
                className={
                  state.ok
                    ? "text-xs text-muted-foreground"
                    : "text-xs text-destructive"
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
