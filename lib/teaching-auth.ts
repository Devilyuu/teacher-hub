import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 教案回流接口的服务令牌鉴权（规格 §5.4）。
 *
 * 这个接口**没有会话 cookie**——调用方是独立部署的备课系统。所以它必须进
 * `isPublicUnauthenticatedPath` 白名单，否则 proxy 会把外部调用重定向到
 * HTML 登录页，对方拿到的是一张网页而不是 401。
 *
 * 进白名单等于放宽 proxy 的保护边界，令牌就成了唯一的门：
 *
 * - 令牌与**登录口令分离**，各自独立轮换。备课系统被攻破不应该等于本平台被攻破
 * - 先 SHA-256 再定长比较：`timingSafeEqual` 要求两侧等长，直接比原文会在
 *   长度不同时抛错，那本身就泄漏了长度信息
 * - 未配置令牌时一律拒绝（**不是放行**）。配置缺失是运维事故，
 *   把它降级成"谁都能传教案进来"是把事故变成漏洞
 */

type Env = Record<string, string | undefined>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 从 `Authorization: Bearer <token>` 里取出令牌 */
export function bearerToken(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

export function teachingTokenMatches(
  candidate: string | undefined,
  env: Env = process.env,
): boolean {
  const expected = env.TEACHING_IMPORT_TOKEN;
  if (!candidate || !expected) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

/**
 * 未通过时返回固定的 401 JSON，**不透露任何业务信息**（规格 §5.4）：
 * 不区分「没配令牌」「令牌错了」「格式不对」——对调用方来说都是没权限，
 * 差异只会帮攻击者定位。
 */
export function teachingImportGuard(request: Request, env: Env = process.env): Response | null {
  if (teachingTokenMatches(bearerToken(request.headers.get("authorization")), env)) return null;
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
