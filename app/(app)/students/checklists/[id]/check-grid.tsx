"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteChecklist, setCheckmark, setChecklistClosed } from "../../actions";

export type CheckStudent = { id: string; name: string };

/**
 * 勾名单的核心交互：点名字 = 交了/没交切换，十秒收完一轮。
 *
 * 本地乐观状态 + 后台写库：一口气勾三十个不能每下都等一次往返。
 * 单人使用没有并发写，本地状态就是真相，服务端迟早追平。
 */
export function CheckGrid({
  checklistId,
  title,
  students,
  initialCheckedIds,
  closed,
}: {
  checklistId: string;
  title: string;
  students: CheckStudent[];
  initialCheckedIds: string[];
  closed: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(() => new Set(initialCheckedIds));
  const [, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const unchecked = students.filter((student) => !checked.has(student.id));

  function toggle(studentId: string) {
    if (closed) return;
    const next = new Set(checked);
    const nowChecked = !next.has(studentId);
    if (nowChecked) next.add(studentId);
    else next.delete(studentId);
    setChecked(next);
    startTransition(async () => {
      await setCheckmark(checklistId, studentId, nowChecked);
    });
  }

  async function copyUnchecked() {
    const names = unchecked.map((student) => student.name);
    const text =
      names.length === 0
        ? `【${title}】已全部收齐（${students.length}/${students.length}）`
        : `【${title}】还差 ${names.length} 人：${names.join("、")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板被浏览器拦住时退回老办法
      window.prompt("复制下面这段", text);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          已交{" "}
          <span className="font-medium text-foreground tabular-nums">
            {checked.size}/{students.length}
          </span>
        </p>
        <Button type="button" size="sm" variant="ghost" className="bg-well" onClick={copyUnchecked}>
          <Copy className="size-3.5" aria-hidden />
          {copied ? "已复制" : "复制未交名单"}
        </Button>
        {closed ? (
          <span className="text-xs text-muted-foreground">已结束，只读</span>
        ) : null}
      </div>

      {/* 选中 = 墨色实心、未选 = well（筛选胶囊的规矩），点名字即切换 */}
      <div className="flex flex-wrap gap-2">
        {students.map((student) => {
          const isChecked = checked.has(student.id);
          return (
            <button
              key={student.id}
              type="button"
              onClick={() => toggle(student.id)}
              disabled={closed}
              aria-pressed={isChecked}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors disabled:cursor-default",
                isChecked
                  ? "bg-primary font-medium text-primary-foreground"
                  : "bg-well text-muted-foreground hover:text-foreground",
              )}
            >
              {isChecked ? <Check className="size-3.5" aria-hidden /> : null}
              {student.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <form action={setChecklistClosed.bind(null, checklistId, !closed)}>
          <Button type="submit" variant="ghost" size="sm" className="bg-well">
            {closed ? "重新打开" : "结束收缴"}
          </Button>
        </form>
        <form
          action={async () => {
            await deleteChecklist(checklistId);
            router.push("/students/checklists");
          }}
        >
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={(event) => {
              if (!confirm(`删除「${title}」和所有勾？查历史用「结束收缴」，别删。`))
                event.preventDefault();
            }}
          >
            删除
          </Button>
        </form>
      </div>
    </div>
  );
}
