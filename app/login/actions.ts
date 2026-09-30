"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  SESSION_COOKIE,
  createSessionToken,
  safeRedirectTarget,
  sessionCookieSecure,
  verifyPasscode,
} from "@/lib/auth";
import {
  checkLoginAllowed,
  clearLoginFailures,
  clientKeyFromHeaders,
  recordLoginFailure,
  type ThrottleStore,
} from "@/lib/login-throttle";

const loginSchema = z.object({
  passcode: z.string().min(1, "请输入口令"),
  // 登录后要跳回的站内路径
  from: z.string().optional(),
});

export type LoginState = { error: string | null };

/**
 * 进程内的失败计数。单实例部署，不需要跨进程共享；
 * 规则见 lib/login-throttle.ts
 */
const loginAttempts: ThrottleStore = new Map();

function retryMessage(seconds: number): string {
  if (seconds >= 60) return `错误次数过多，请 ${Math.ceil(seconds / 60)} 分钟后再试`;
  return `错误次数过多，请 ${seconds} 秒后再试`;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    passcode: formData.get("passcode"),
    from: formData.get("from") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "口令格式不正确" };
  }

  const clientKey = clientKeyFromHeaders(await headers());
  const gate = checkLoginAllowed(loginAttempts, clientKey);
  if (!gate.allowed) {
    return { error: retryMessage(gate.retryAfterSeconds) };
  }

  if (!(await verifyPasscode(parsed.data.passcode))) {
    const verdict = recordLoginFailure(loginAttempts, clientKey);
    return {
      error: verdict.allowed ? "口令不正确" : retryMessage(verdict.retryAfterSeconds),
    };
  }
  clearLoginFailures(loginAttempts, clientKey);

  const { value, maxAge } = await createSessionToken();
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge,
  });

  redirect(safeRedirectTarget(parsed.data.from));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
