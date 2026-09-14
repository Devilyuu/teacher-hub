"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IDLE_FORM_STATE } from "@/lib/form-state";
import { deleteAchievement } from "@/app/(app)/achievements/actions";

function SubmitButton({ onConfirm }: { onConfirm: () => boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-destructive"
      onClick={(event) => {
        if (!onConfirm()) event.preventDefault();
      }}
    >
      <Trash2 className="size-3.5" aria-hidden />
      {pending ? "删除中…" : "删除成果"}
    </Button>
  );
}

/**
 * 删除成果。
 *
 * **不做归档、就是真删**：成果台账里误录一条（重复导入、录错对象）是常事，
 * 留一堆归档记录只会让台账更难看清。真正需要留痕的历史课题副本走的是 2.7 的
 * 软归档，那类记录服务端会另外挡住。
 *
 * 挂接被确认达标时服务端会拒绝并给出原因，所以这里用 `useActionState` 接返回值——
 * 裸 `<form action>` 会把那句话丢掉，按下去什么都不发生，看起来像坏了。
 */
export function DeleteAchievementButton({
  achievementId,
  title,
  attachmentCount,
}: {
  achievementId: string;
  title: string;
  attachmentCount: number;
}) {
  const action = deleteAchievement.bind(null, achievementId);
  const [state, formAction] = useActionState(action, IDLE_FORM_STATE);

  function confirmDelete(): boolean {
    // 附件会跟着一起没，数量要说出来——「删一条成果」和
    // 「删一条成果连带 5 份支撑材料」是两回事
    const attachmentNote =
      attachmentCount > 0 ? `，连同 ${attachmentCount} 份支撑材料（磁盘文件一并删除）` : "";
    return confirm(`删除「${title}」${attachmentNote}？此操作无法撤销。`);
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <SubmitButton onConfirm={confirmDelete} />
      {state.message ? (
        <span className="text-xs text-destructive">{state.message}</span>
      ) : null}
    </form>
  );
}
