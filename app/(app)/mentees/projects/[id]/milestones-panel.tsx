"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { MILESTONE_SUGGESTIONS } from "@/lib/schemas/mentee";
import { createMenteeMilestone, deleteMenteeMilestone } from "../../actions";

export type MilestoneRow = {
  id: string;
  label: string;
  /** 格式化好的日期；没填精确日期时为 null（「五月底答辩」那种） */
  dateText: string | null;
  note: string | null;
  /** 日期已经过去了。**只是排版用的淡化，不是状态判定** */
  past: boolean;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}

/**
 * 关键节点：开题、中期检查、答辩、作品提交。
 *
 * **画成时间序列表，不画步骤条**——步骤条会被读成关卡，而这里
 * 没有「完成」标记、没有顺序约束、没有「上一步没过不许下一步」
 * （第 1 条铁律 + 本平台不是工作流工具）。有日期就说明它排在那天。
 */
export function MilestonesPanel({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: MilestoneRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [state, action] = useActionState(
    createMenteeMilestone.bind(null, projectId),
    IDLE_FORM_STATE,
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-base font-semibold">关键节点</h2>
        {!adding ? (
          <Button type="button" size="sm" variant="ghost" className="bg-well" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden />
            加节点
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form action={action} className="surface space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="milestone-label">节点</Label>
              {/* datalist 是**建议不是枚举**——每个专业的节奏不一样，
                  而节点名不进任何统计，上字典表只是维护负担 */}
              <Input
                id="milestone-label"
                name="label"
                list="milestone-suggestions"
                required
                autoFocus
                placeholder="开题 / 中期检查 / 答辩…"
              />
              <datalist id="milestone-suggestions">
                {MILESTONE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="milestone-date">日期</Label>
              <Input id="milestone-date" name="date" type="date" />
              <p className="text-xs text-muted-foreground">
                只知道「五月底」就留空，写进下面的备注——填一个看起来精确的假日期更糟。
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-note">备注</Label>
            <Input id="milestone-note" name="note" placeholder="地点、评委、要带什么…" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label="添加" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              收起
            </Button>
            {state.message ? (
              <span className={formMessageClass(state.ok)}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}

      {milestones.length === 0 ? (
        <p className="measure rounded-3xl bg-well p-6 text-center text-sm text-muted-foreground">
          还没排节点。填了精确日期的会出现在月历和首页倒计时里。
        </p>
      ) : (
        <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
          {milestones.map((milestone) => (
            <li
              key={milestone.id}
              className={`flex items-start gap-3 px-4 py-2.5 ${milestone.past ? "opacity-60" : ""}`}
            >
              <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                {milestone.dateText ?? "日期未填"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{milestone.label}</p>
                {milestone.note ? (
                  <p className="measure text-xs text-muted-foreground">{milestone.note}</p>
                ) : null}
              </div>
              <ConfirmSubmitButton
                action={deleteMenteeMilestone.bind(null, milestone.id)}
                message={`删除节点「${milestone.label}」？找不回来。`}
                size="icon-sm"
                label={`删除节点 ${milestone.label}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </ConfirmSubmitButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
