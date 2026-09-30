/**
 * 登录口的失败退避（纯函数，单测在同名 .test.ts）。
 *
 * 整站只有一道静态口令，没有限速时攻击成本只取决于口令熵。
 * 单人、单实例部署，所以用进程内的 Map 就够，不上 Redis：
 * 进程重启计数归零是可接受的——攻击者也得等重启。
 *
 * 规则：15 分钟窗口内连错 5 次开始封，封锁时长 30s 起每多错一次翻倍，
 * 上限 15 分钟。登录成功即清零。
 */

export type ThrottleEntry = {
  failures: number;
  windowStart: number;
  blockedUntil: number;
};

export type ThrottleStore = Map<string, ThrottleEntry>;

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FREE_FAILURES = 5;
const BASE_BLOCK_MS = 30 * 1000;
const MAX_BLOCK_MS = 15 * 60 * 1000;
/** Map 里最多留这么多 key；超过就把过期的清掉，防止被海量 IP 撑爆内存 */
const MAX_TRACKED_KEYS = 10_000;

export type ThrottleVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function checkLoginAllowed(
  store: ThrottleStore,
  key: string,
  now: number = Date.now(),
): ThrottleVerdict {
  const entry = store.get(key);
  if (!entry) return { allowed: true };
  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
    };
  }
  return { allowed: true };
}

export function recordLoginFailure(
  store: ThrottleStore,
  key: string,
  now: number = Date.now(),
): ThrottleVerdict {
  pruneExpired(store, now);
  const previous = store.get(key);
  const inWindow = previous != null && now - previous.windowStart < LOGIN_WINDOW_MS;
  const failures = inWindow ? previous.failures + 1 : 1;
  const windowStart = inWindow ? previous.windowStart : now;

  let blockedUntil = 0;
  if (failures >= LOGIN_FREE_FAILURES) {
    const exponent = failures - LOGIN_FREE_FAILURES;
    blockedUntil = now + Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** exponent);
  }
  store.set(key, { failures, windowStart, blockedUntil });
  return checkLoginAllowed(store, key, now);
}

export function clearLoginFailures(store: ThrottleStore, key: string): void {
  store.delete(key);
}

function pruneExpired(store: ThrottleStore, now: number): void {
  if (store.size < MAX_TRACKED_KEYS) return;
  for (const [key, entry] of store) {
    if (entry.blockedUntil <= now && now - entry.windowStart >= LOGIN_WINDOW_MS) {
      store.delete(key);
    }
  }
}

/** 所有人共用一个计数时的键；声明要信的那个头没来，也落到这里 */
const SHARED_CLIENT_KEY = "local";

export type ClientIpHeader = "x-forwarded-for" | "x-real-ip" | "none";

/**
 * 计数键信哪个请求头，由环境变量 CLIENT_IP_HEADER 声明。只认下面三个值，别的值当没设。
 *
 * **只能信反代自己写的那个值。** 客户端带来的头原样进得来，信了它，攻击者每次请求换一个值
 * 就换出一个新的计数键，退避形同虚设——2026-09-28 之前取的正是 X-Forwarded-For 第一段。
 *
 * - `x-forwarded-for`（默认）：取**最后一段**。宿主机 Nginx 的 `$proxy_add_x_forwarded_for`
 *   把客户端自带的值原样留着、真实地址追加在最后；Caddy 对不受信的来源直接覆盖成真实地址。
 *   仓库里这两种部署它都对，反代配置由 login-throttle.test.ts 钉着
 * - `x-real-ip`：反代覆盖写入 X-Real-IP 时可用（Nginx 的 `proxy_set_header X-Real-IP $remote_addr`）。
 *   **Caddy 不碰这个头**，客户端带什么就透传什么（2026-09-28 实测 v2.11），所以不当默认
 * - `none`：谁也不信，所有人共用一个计数。给桌面版用：手机经 desktop/src/phone-gateway.ts 进来，
 *   转发头在那里被改写成真实地址，但计数不押在网关上——哪天漏改一个头，退避又能换个值绕开
 *   （没有会改写转发头的一层时，Next 也只在请求没带 XFF 时才拿 socket 地址补上）。
 *   桌面窗口的会话 cookie 是主进程直接种的、不走登录表单，全局计数锁不到本人
 */
export function clientIpHeader(
  env: Record<string, string | undefined> = process.env,
): ClientIpHeader {
  const raw = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (raw === "x-real-ip" || raw === "none") return raw;
  return "x-forwarded-for";
}

/**
 * 从请求头里取客户端标识：只看 `trusted` 声明的那一个头，取最后一段（X-Real-IP 本来只有一段，
 * 同一个写法）。它没来就落到共用的固定键。**别加「这个没有再看那个」的退路**——
 * 退到一个没声明可信的头上，等于把伪造的口子从后门开回来。
 */
export function clientKeyFromHeaders(
  headers: { get(name: string): string | null },
  trusted: ClientIpHeader = clientIpHeader(),
): string {
  if (trusted === "none") return SHARED_CLIENT_KEY;
  const last = headers.get(trusted)?.split(",").at(-1)?.trim();
  return last || SHARED_CLIENT_KEY;
}
