"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { COMPETITION_AWARD_LABELS } from "@/lib/labels";
import { adoptCompetitionEntry } from "../actions";
import type { CompetitionAward } from "@/lib/generated/prisma/enums";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Trophy className="size-3.5" aria-hidden />
      {pending ? "处理中…" : "引用为成果"}
    </Button>
  );
}

/**
 * 引用为成果。
 *
 * **这是参赛进入台账的唯一路径**，系统永远不会自己走这一步（第 1 条铁律）——
 * 参赛按赛季产出，自动入库会把「待核实」队列淹掉，和教案回流一个道理。
 *
 * 引用出来的成果 `isVerified = false`：绩效小类和职称指标一概不猜，
 * 那是两套互相正交的坐标系（第 11 条），系统替人挑必然挑错。
 */
export function AdoptPanel({
  entryId,
  award,
  awardTitle,
  achievement,
}: {
  entryId: string;
  award: CompetitionAward | null;
  awardTitle: string | null;
  achievement: { id: string; title: string } | null;
}) {
  const [state, action] = useActionState(adoptCompetitionEntry, IDLE_FORM_STATE);

  if (achievement) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-well px-5 py-3 text-sm">
        <span className="text-muted-foreground">已引用为成果</span>
        <Link
          href={`/achievements/${achievement.id}`}
          className="min-w-0 truncate underline underline-offset-4"
        >
          {achievement.title}
        </Link>
        <span className="text-xs text-muted-foreground">
          获奖证书已随成果转出，通知和报名表留在下面的材料里
        </span>
      </div>
    );
  }

  // 还没出结果的记录不摆这个按钮：点了也只会得到一句「先填上奖项」，
  // 摆在那儿只是让人以为少做了一步
  if (award == null || award === "NONE") {
    return null;
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-well px-5 py-3"
    >
      <input type="hidden" name="entryId" value={entryId} />
      <p className="measure min-w-0 flex-1 text-sm">
        这次拿了
        <span className="px-1 font-medium">
          {awardTitle ?? COMPETITION_AWARD_LABELS[award]}
        </span>
        。引用为成果会在台账里建一条「指导学生」，落进
        <span className="px-1 text-foreground">待核实</span>
        等你补绩效和职称口径。
      </p>
      <SubmitButton />
      {state.message ? (
        <span className={formMessageClass(state.ok)}>{state.message}</span>
      ) : null}
    </form>
  );
}
