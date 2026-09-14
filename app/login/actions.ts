"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE, createSessionToken, verifyPasscode } from "@/lib/auth";

const loginSchema = z.object({
  passcode: z.string().min(1, "请输入口令"),
  // 登录后要跳回的站内路径
  from: z.string().optional(),
});

export type LoginState = { error: string | null };

/** 只接受站内绝对路径，挡掉 //evil.com 这类开放重定向 */
function safeRedirectTarget(from: string | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "/";
  return from;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    passcode: formData.get("passcode"),
    from: formData.get("from") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "口令格式不正确" };
  }

  if (!verifyPasscode(parsed.data.passcode)) {
    return { error: "口令不正确" };
  }

  const { value, maxAge } = await createSessionToken();
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });

  redirect(safeRedirectTarget(parsed.data.from));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
