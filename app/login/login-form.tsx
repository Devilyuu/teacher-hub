"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    // 登录是手机上的第一次点击，40px 比全站默认的 32px 更接近推荐触控目标；
    // 这页只有一个输入一颗按钮，大一号也不挤
    <Button type="submit" className="h-10 w-full" disabled={pending}>
      {pending ? "校验中…" : "进入"}
    </Button>
  );
}

export function LoginForm({ from }: { from?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, { error: null });

  return (
    <form action={formAction} className="space-y-4">
      {from ? <input type="hidden" name="from" value={from} /> : null}

      <div className="space-y-2">
        <Label htmlFor="passcode">口令</Label>
        <Input
          id="passcode"
          name="passcode"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="请输入访问口令"
          className="h-10"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
