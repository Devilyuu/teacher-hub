import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

type SessionTokenReader = () => Promise<string | undefined>;

async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * Server Actions 和 Route Handlers 都是可直接请求的公开端点。
 * proxy 只负责早期重定向，真正的数据写入必须在动作内部再次验签。
 */
export async function requireSession(
  readToken: SessionTokenReader = readSessionCookie,
): Promise<void> {
  if (!(await verifySessionToken(await readToken()))) {
    throw new Error("未登录");
  }
}

/**
 * Route Handler 用的会话闸门。**未登录返回 401 Response，已登录返回 null**：
 *
 * ```ts
 * export async function GET() {
 *   const denied = await sessionGuard();
 *   if (denied) return denied;
 *   …
 * }
 * ```
 *
 * 为什么不直接用 `requireSession()`：它抛异常，在 Route Handler 里会变成
 * 500 而不是 401——对调用方来说「服务器炸了」和「你没登录」是两件事。
 *
 * 为什么要有这个函数而不是每个接口手写五行 cookie 校验：**门禁认不出手写的**。
 * `scripts/verify-server-actions-auth.mjs` 靠识别这一句来断言每个接口都鉴权了；
 * 三期要新增材料 ZIP、结题 Word、音频上传、转写、教案回流一堆接口，
 * 少写一次就是一个公开的数据出口。
 */
export async function sessionGuard(
  readToken: SessionTokenReader = readSessionCookie,
): Promise<Response | null> {
  if (await verifySessionToken(await readToken())) return null;
  return new Response("未登录", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
