/**
 * 单人使用的口令登录（PRD 第 5 节 非功能需求）。
 *
 * 不做用户体系：口令存环境变量 APP_PASSCODE，校验通过后下发一个 HMAC 签名的
 * cookie，proxy.ts 在每个请求上验签。全部用 Web Crypto 实现，
 * 这样 Edge 运行时的 proxy.ts 和 Node 运行时的 Server Action 能共用同一份代码。
 */

export const SESSION_COOKIE = "keti_session";

/**
 * 不需要会话 cookie 的路径（规格 §5.4）。
 *
 * 只有**调用方本来就没有会话**的接口才配进来，且每个都必须有替代鉴权：
 * `/api/maintenance/cleanup` 用 `X-Maintenance-Token`，
 * `/api/teaching/import` 用 `Authorization: Bearer`。
 *
 * **录音上传、分片、转写触发、音频下载、全库备份一律不得进来**——它们的调用方
 * 是登录用户的浏览器，本来就带着 cookie。往这里加一条就是开一个公开的数据出口，
 * `lib/auth.test.ts` 有反向断言盯着这几个路径。
 */
export function isPublicUnauthenticatedPath(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/api/health"
    || pathname === "/api/maintenance/cleanup"
    || pathname === "/api/teaching/import";
}

/** 会话有效期：30 天 */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请参照 .env.example 配置`);
  }
  return value;
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireEnv("APP_SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** 定长比较，避免用 === 比较签名时泄漏时序信息 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function verifyPasscode(input: string): boolean {
  const expected = requireEnv("APP_PASSCODE");
  return timingSafeEqual(input, expected);
}

/** 生成会话 cookie 的值：`过期时间戳.签名` */
export async function createSessionToken(): Promise<{ value: string; maxAge: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  return {
    value: `${payload}.${await sign(payload)}`,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return false;

  return timingSafeEqual(signature, await sign(payload));
}
