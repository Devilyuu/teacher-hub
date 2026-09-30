import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOGIN_FREE_FAILURES,
  LOGIN_WINDOW_MS,
  checkLoginAllowed,
  clearLoginFailures,
  clientIpHeader,
  clientKeyFromHeaders,
  recordLoginFailure,
  type ThrottleStore,
} from "./login-throttle";

const T0 = 1_700_000_000_000;

function failTimes(store: ThrottleStore, key: string, times: number, now: number) {
  let verdict = checkLoginAllowed(store, key, now);
  for (let i = 0; i < times; i++) verdict = recordLoginFailure(store, key, now);
  return verdict;
}

describe("登录失败退避", () => {
  it("没记录过的 key 直接放行", () => {
    expect(checkLoginAllowed(new Map(), "192.0.2.1", T0)).toEqual({ allowed: true });
  });

  it("前四次错不封，第五次开始封 30 秒", () => {
    const store: ThrottleStore = new Map();
    expect(failTimes(store, "ip", LOGIN_FREE_FAILURES - 1, T0)).toEqual({ allowed: true });
    const verdict = recordLoginFailure(store, "ip", T0);
    expect(verdict).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(checkLoginAllowed(store, "ip", T0 + 29_000).allowed).toBe(false);
    expect(checkLoginAllowed(store, "ip", T0 + 30_000).allowed).toBe(true);
  });

  it("继续错封锁时长翻倍，封到 15 分钟为止", () => {
    const store: ThrottleStore = new Map();
    failTimes(store, "ip", LOGIN_FREE_FAILURES, T0);
    expect(recordLoginFailure(store, "ip", T0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(recordLoginFailure(store, "ip", T0)).toEqual({ allowed: false, retryAfterSeconds: 120 });
    for (let i = 0; i < 10; i++) recordLoginFailure(store, "ip", T0);
    expect(recordLoginFailure(store, "ip", T0)).toEqual({
      allowed: false,
      retryAfterSeconds: 15 * 60,
    });
  });

  it("窗口过了重新计数", () => {
    const store: ThrottleStore = new Map();
    failTimes(store, "ip", LOGIN_FREE_FAILURES - 1, T0);
    const later = T0 + LOGIN_WINDOW_MS;
    expect(recordLoginFailure(store, "ip", later)).toEqual({ allowed: true });
    expect(store.get("ip")?.failures).toBe(1);
  });

  it("登录成功清零，不同 key 互不影响", () => {
    const store: ThrottleStore = new Map();
    failTimes(store, "a", LOGIN_FREE_FAILURES, T0);
    expect(checkLoginAllowed(store, "b", T0)).toEqual({ allowed: true });
    clearLoginFailures(store, "a");
    expect(checkLoginAllowed(store, "a", T0)).toEqual({ allowed: true });
  });
});

describe("clientKeyFromHeaders", () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  });
  const REAL = "203.0.113.7";
  /**
   * 宿主机 Nginx 转过来的请求：`$proxy_add_x_forwarded_for` 把客户端自带的 XFF 原样留着、
   * 真实地址追加在最后；`X-Real-IP $remote_addr` 是覆盖写入
   */
  const viaNginx = (forgedXff?: string) =>
    headers({
      "x-forwarded-for": forgedXff ? `${forgedXff}, ${REAL}` : REAL,
      "x-real-ip": REAL,
    });
  const FORGED = ["198.51.100.9", "10.0.0.1, 10.0.0.2", "203.0.113.8", "local", " , "];

  it("默认取 X-Forwarded-For 最后一段——反代追加的真实地址", () => {
    expect(clientKeyFromHeaders(viaNginx("198.51.100.9"))).toBe(REAL);
    // Caddy 对不受信的来源直接把 XFF 覆盖成真实地址，只剩一段
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": REAL }))).toBe(REAL);
  });

  it.each(["x-forwarded-for", "x-real-ip", "none"] as const)(
    "客户端伪造的 X-Forwarded-For 换不出新的计数键（%s）",
    (trusted) => {
      const keys = new Set(FORGED.map((xff) => clientKeyFromHeaders(viaNginx(xff), trusted)));
      expect(keys.size).toBe(1);
    },
  );

  it("每次请求换一个伪造值，照样被封", () => {
    const store: ThrottleStore = new Map();
    for (let i = 0; i < LOGIN_FREE_FAILURES; i++) {
      recordLoginFailure(store, clientKeyFromHeaders(viaNginx(`10.0.0.${i}`)), T0);
    }
    const next = clientKeyFromHeaders(viaNginx("10.9.9.9"));
    expect(checkLoginAllowed(store, next, T0).allowed).toBe(false);
  });

  it("x-real-ip 取反代覆盖写入的那个值", () => {
    expect(clientKeyFromHeaders(viaNginx("198.51.100.9"), "x-real-ip")).toBe(REAL);
  });

  it("只看声明的那一个头：它没来就落到固定值，不退去信另一个", () => {
    // Caddy 原样透传客户端带来的 X-Real-IP，默认口径退到它就又能伪造了
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "198.51.100.7" }))).toBe("local");
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "198.51.100.9" }), "x-real-ip")).toBe("local");
    expect(clientKeyFromHeaders(headers({}))).toBe("local");
  });

  it("none 谁也不信，带什么头都落到同一个固定值", () => {
    expect(clientKeyFromHeaders(viaNginx("198.51.100.9"), "none")).toBe("local");
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "198.51.100.7" }), "none")).toBe("local");
  });
});

describe("clientIpHeader（环境变量 CLIENT_IP_HEADER）", () => {
  it("不设、留空、认不出的值都当没设：默认信 X-Forwarded-For", () => {
    expect(clientIpHeader({})).toBe("x-forwarded-for");
    expect(clientIpHeader({ CLIENT_IP_HEADER: "" })).toBe("x-forwarded-for");
    expect(clientIpHeader({ CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("x-forwarded-for");
  });

  it("大小写和首尾空格不影响", () => {
    expect(clientIpHeader({ CLIENT_IP_HEADER: " X-Real-IP " })).toBe("x-real-ip");
    expect(clientIpHeader({ CLIENT_IP_HEADER: "None" })).toBe("none");
  });
});

/**
 * 默认口径「XFF 最后一段是真实地址」是反代给的保证，不是应用自己能确认的。
 * 反代配置一改，这条保证就没了，而退避失效不报任何错——所以把仓库里的两份配置钉住。
 * 服务器上 /etc/nginx 里那份这里管不着，见 docs/deploy.md 第 5 节。
 */
describe("仓库里的反代配置与默认口径对得上", () => {
  const read = (relative: string) =>
    readFileSync(resolve(import.meta.dirname, "..", relative), "utf8");

  it.each(["deploy/nginx/desk.conf", "deploy/nginx/desk-http.conf"])(
    "%s 把真实地址写在 X-Forwarded-For 最后一段",
    (file) => {
      const values = [...read(file).matchAll(/proxy_set_header\s+X-Forwarded-For\s+([^;]+);/gi)]
        .map((match) => match[1]!.trim());
      expect(values.length).toBeGreaterThan(0);
      // 追加（$proxy_add_x_forwarded_for）或覆盖（$remote_addr）都行；
      // 透传 $http_x_forwarded_for 的话最后一段也成了客户端说了算
      for (const value of values) {
        expect(["$proxy_add_x_forwarded_for", "$remote_addr"]).toContain(value);
      }
    },
  );

  it("Caddyfile 不改写 X-Forwarded-For——Caddy 默认对不受信的来源覆盖成真实地址", () => {
    expect(read("Caddyfile")).not.toMatch(/header_up\s+[-+]?X-Forwarded-For/i);
  });
});
