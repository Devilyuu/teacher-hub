"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE, formMessageClass } from "@/lib/form-state";
import { adoptMenteeProject } from "../../actions";

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
 * 引用为成果（M3）。和参赛详情页那块长一个样——同一个动作在不同页面要长一个样。
 *
 * **这是学生项目进台账的唯一路径**，系统永远不会自己走这一步（第 1 条铁律）。
 * 建出来的成果落进「待核实」：级别、年度、绩效小类、职称指标一概不猜。
 *
 * 结项情况没填时整块不画（同参赛「没出结果不摆按钮」）：大多数项目本来就
 * 不该进台账——带学生本身不算分，摆一个灰按钮只会让人以为少做了一步。
 * 「填了结项情况才能引用」这句话写在结项情况那一格的说明里。
 */
export function AdoptPanel({
  projectId,
  outcomeText,
  previewTitle,
  movedKindLabels,
  achievement,
}: {
  projectId: string;
  outcomeText: string | null;
  /** 引用后那条成果的标题，服务端按 `menteeAchievementTitle` 算好 */
  previewTitle: string | null;
  /** 会跟着成果走的材料类型，读 `MENTEE_ADOPT_ATTACHMENT_KINDS` */
  movedKindLabels: string[];
  achievement: { id: string; title: string } | null;
}) {
  const [state, action] = useActionState(adoptMenteeProject, IDLE_FORM_STATE);

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
          {movedKindLabels.join("、")}已随成果转出，过程材料留在下面
        </span>
      </div>
    );
  }

  if (!outcomeText || !previewTitle) return null;

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-well px-5 py-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <p className="measure min-w-0 flex-1 text-sm">
        结项情况：<span className="font-medium">{outcomeText}</span>。
        引用为成果会在台账里建一条
        <span className="px-1 text-foreground">「{previewTitle}」</span>，落进
        <span className="px-1 text-foreground">待核实</span>
        等你补绩效和职称口径；{movedKindLabels.join("、")}跟着成果走。
        <span className="text-muted-foreground">
          带学生本身不算分，值得进台账的是获优秀、学生一作论文、学生知识产权这类结果。
        </span>
      </p>
      <SubmitButton />
      {state.message ? (
        <span className={formMessageClass(state.ok)}>{state.message}</span>
      ) : null}
    </form>
  );
}
