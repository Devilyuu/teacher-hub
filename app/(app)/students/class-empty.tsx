"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formMessageClass, IDLE_FORM_STATE } from "@/lib/form-state";
import { createClassGroup } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "建班中…" : "建班"}
    </Button>
  );
}

/**
 * 还没有班时的引导态：一句话 + 建班表单，建完直接进名册。
 * 班主任模块的一切都挂在班级下面，这是唯一的起点。
 */
export function ClassEmptyState() {
  const [state, action] = useActionState(createClassGroup, IDLE_FORM_STATE);

  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-well p-14 text-center">
      <UsersRound className="size-12 text-muted-foreground/60" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">先建一个班</p>
        <p className="measure text-sm text-muted-foreground">
          名册、勾名单、荣誉、记录都挂在班级下面。建完班就能粘贴名单批量导入学生。
        </p>
      </div>
      <form action={action} className="flex w-full max-w-sm flex-col gap-3 text-left">
        <div className="space-y-1.5">
          <Label htmlFor="class-name">班级名</Label>
          <Input id="class-name" name="name" placeholder="如「智能2201班」" required />
        </div>
        <div className="flex items-center justify-center gap-3">
          <SubmitButton />
          {state.message ? (
            <p className={formMessageClass(state.ok)}>{state.message}</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
