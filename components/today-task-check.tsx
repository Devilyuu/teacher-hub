"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toggleTaskDone } from "@/app/(app)/tasks/actions";

/**
 * 首页「今天要处理」每一行前面的完成勾选。
 *
 * 首页只放能被处理掉的事（CLAUDE.md），原来这里每条只是个去 /tasks 的链接——
 * 看得见、处理不了，还得再跳一页找到它再勾（2026-09-14 审计第二节、09-25 评审都点过）。
 * 勾完这一行随 revalidate 从首页消失，所以和任务删除一样给「撤销」Toast，停 8 秒。
 *
 * 点击区同 task-row.tsx：外包 label 撑到手机 44px、桌面 32px，负外边距抵掉，视觉位置不动
 */
export function TodayTaskCheck({ id, title }: { id: string; title: string }) {
  const [pending, setPending] = useState(false);

  return (
    <label className="-m-2 flex shrink-0 cursor-pointer items-center justify-center self-center p-2 max-md:-m-3 max-md:p-3">
      <input
        type="checkbox"
        checked={false}
        disabled={pending}
        aria-label={`完成「${title}」`}
        onChange={async () => {
          setPending(true);
          await toggleTaskDone(id, true);
          setPending(false);
          toast("已完成", {
            description: title,
            duration: 8000,
            action: { label: "撤销", onClick: () => void toggleTaskDone(id, false) },
          });
        }}
        className="size-4 max-md:size-5"
      />
    </label>
  );
}
