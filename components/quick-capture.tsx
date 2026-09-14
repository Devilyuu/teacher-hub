"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCapture } from "@/lib/actions/capture-actions";
import { CAPTURE_KIND_LABELS, type CaptureKind } from "@/lib/capture";
import { IDLE_FORM_STATE, type FormState } from "@/lib/form-state";

const KINDS = Object.keys(CAPTURE_KIND_LABELS) as CaptureKind[];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "记录中…" : "记下"}
    </Button>
  );
}

/**
 * 顶栏常驻的快速记录（二期规格 §7.1）。
 *
 * **唯一的设计目标是快**：从点开到关掉不超过 30 秒。所以只有三个类型按钮、
 * 一个标题输入框和一段可选补充——想到什么先落进收件箱，归类和补全是后面的事
 * （第一性原理第 1 条：采集不等于事实）。类型选错不要紧，收件箱里能改。
 *
 * 原来是手写的 `fixed inset-0` 浮层，三个毛病（2026-09-13 改用 Dialog）：
 *
 * 1. **关掉就丢草稿。** 关闭时整个表单卸载，Esc、点遮罩、点叉三个出口
 *    都会把写了一半的内容直接扔掉，而且没有任何提示
 * 2. **焦点不圈定**：Tab 能跳到浮层后面的页面上去
 * 3. **焦点回不去**：触发按钮是随 open 状态重新挂载的，关掉后焦点落到 body
 *
 * Base UI 的 Dialog 管住了 2 和 3。第 1 条靠拦截关闭：**只在确实写了内容时**
 * 才拦下来问「继续编辑 / 放弃」——空的面板照样一按 Esc 就走，
 * 不能为了保护草稿把「快」这个唯一目标搭进去。
 */
export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CaptureKind>("TASK");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // 存成功后清空、关闭、给个回执。**面板关掉才算完成一次记录**——留着开着
  // 会让人以为没存上，又记一遍；关掉之后又得有一句话说明它去哪了。
  //
  // 收尾写在 action 里而不是 `useEffect(..., [state.ok])`：后者是在 effect 里
  // setState，会多跑一轮渲染，`react-hooks/set-state-in-effect` 也会拦。
  const [state, formAction] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await createCapture(prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setConfirmingDiscard(false);
      setOpen(false);
      toast("已记入收件箱", { description: "回头在首页归类" });
    }
    return result;
  }, IDLE_FORM_STATE);

  /** 只看两段文字。类型按钮点过不算「写了东西」——丢了也不心疼 */
  function hasDraft() {
    const form = formRef.current;
    if (!form) return false;
    const data = new FormData(form);
    return [data.get("title"), data.get("content")].some(
      (value) => typeof value === "string" && value.trim() !== "",
    );
  }

  function discard() {
    formRef.current?.reset();
    setKind("TASK");
    setConfirmingDiscard(false);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setOpen(true);
          return;
        }
        if (hasDraft()) {
          // 拦下来，在面板里就地问——不再叠一层原生 confirm，
          // 那样手机上是一个系统弹窗压着另一个弹窗
          details.cancel();
          setConfirmingDiscard(true);
          return;
        }
        discard();
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="快速记录"
            aria-label="快速记录"
            className="text-muted-foreground"
          />
        }
      >
        <Plus className="size-4 max-md:size-5" aria-hidden />
      </DialogTrigger>

      {/* 靠上放而不是垂直居中：手机上弹键盘后，居中的对话框会被顶到输入框看不见 */}
      <DialogContent
        initialFocus={titleRef}
        className="top-20 translate-y-0 gap-3 p-5 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">快速记录</DialogTitle>

        <form ref={formRef} action={formAction} className="space-y-3">
          <div className="flex gap-1.5 pr-8">
            {KINDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={
                  kind === value
                    ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground max-md:px-4 max-md:py-2.5"
                    : "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:text-foreground max-md:px-4 max-md:py-2.5"
                }
              >
                {CAPTURE_KIND_LABELS[value]}
              </button>
            ))}
          </div>

          <input type="hidden" name="kind" value={kind} />

          <Input
            ref={titleRef}
            name="title"
            placeholder="一句话，想到什么写什么"
            autoComplete="off"
            aria-label="内容"
            onChange={() => setConfirmingDiscard(false)}
            className="max-md:h-11"
          />

          <Textarea
            name="content"
            rows={2}
            placeholder="补充（可选）"
            aria-label="补充内容"
            onChange={() => setConfirmingDiscard(false)}
          />

          {confirmingDiscard ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-lg bg-well px-3 py-2"
            >
              <span className="mr-auto text-xs">这条还没记下，放弃吗？</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmingDiscard(false);
                  titleRef.current?.focus();
                }}
              >
                继续编辑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={discard}
              >
                放弃
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <SubmitButton />
              <span className="text-xs text-muted-foreground">
                先落进收件箱，回头在首页归类
              </span>
              {state.message && !state.ok ? (
                <span className="text-xs text-destructive">{state.message}</span>
              ) : null}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
