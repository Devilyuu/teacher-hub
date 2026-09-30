"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { sessionCookieSecure } from "@/lib/auth";
import { GETTING_STARTED_DISMISSED_COOKIE } from "@/lib/getting-started";
import { requireSession } from "@/lib/server-auth";

/**
 * 首页「开始使用」的「不再显示」。记在这个浏览器的 cookie 里而不是库里：
 * 电脑上的窗口关了，手机上照样还能看到这三步——它本来就是给「刚开始用」的那台设备看的
 */
export async function dismissGettingStarted(): Promise<void> {
  await requireSession();
  (await cookies()).set(GETTING_STARTED_DISMISSED_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  revalidatePath("/");
}
