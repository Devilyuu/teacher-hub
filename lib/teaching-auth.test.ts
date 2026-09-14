import { describe, expect, it } from "vitest";
import { bearerToken, teachingImportGuard, teachingTokenMatches } from "./teaching-auth";

const env = { TEACHING_IMPORT_TOKEN: "s3cret-teaching-token" };

function request(authorization?: string): Request {
  return new Request("https://example.test/api/teaching/import", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("Bearer 解析", () => {
  it("取出令牌", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
  });

  it("大小写不敏感", () => {
    expect(bearerToken("bearer abc123")).toBe("abc123");
  });

  it("容忍多余空格", () => {
    expect(bearerToken("  Bearer   abc123  ")).toBe("abc123");
  });

  it("拒绝其它方案与空值", () => {
    expect(bearerToken("Basic abc123")).toBeUndefined();
    expect(bearerToken("abc123")).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
    expect(bearerToken("Bearer   ")).toBeUndefined();
    expect(bearerToken(null)).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});

describe("令牌比较", () => {
  it("匹配", () => {
    expect(teachingTokenMatches("s3cret-teaching-token", env)).toBe(true);
  });

  it("不匹配", () => {
    expect(teachingTokenMatches("wrong", env)).toBe(false);
  });

  it("长度不同也不抛错", () => {
    // timingSafeEqual 要求两侧等长；先摘要再比较就是为了这个。
    // 直接比原文会在长度不同时抛异常，异常本身就泄漏了长度
    expect(() => teachingTokenMatches("x", env)).not.toThrow();
    expect(teachingTokenMatches("x", env)).toBe(false);
  });

  it("未配置令牌时拒绝，而不是放行", () => {
    // 配置缺失是运维事故。降级成「谁都能传教案进来」是把事故变成漏洞
    expect(teachingTokenMatches("anything", {})).toBe(false);
    expect(teachingTokenMatches(undefined, {})).toBe(false);
  });

  it("空令牌不能通过", () => {
    expect(teachingTokenMatches("", env)).toBe(false);
    expect(teachingTokenMatches(undefined, env)).toBe(false);
  });
});

describe("闸门", () => {
  it("令牌正确放行", () => {
    expect(teachingImportGuard(request("Bearer s3cret-teaching-token"), env)).toBeNull();
  });

  it("令牌错误返回 401", async () => {
    const denied = teachingImportGuard(request("Bearer nope"), env);
    expect(denied?.status).toBe(401);
    expect(await denied?.json()).toEqual({ error: "unauthorized" });
  });

  it("缺 Authorization 返回 401", () => {
    expect(teachingImportGuard(request(), env)?.status).toBe(401);
  });

  it("未配置令牌时返回 401 而不是 500", async () => {
    const denied = teachingImportGuard(request("Bearer anything"), {});
    expect(denied?.status).toBe(401);
    expect(await denied?.json()).toEqual({ error: "unauthorized" });
  });

  it("拒绝时不透露业务信息", async () => {
    // 不区分「没配令牌」「令牌错了」「格式不对」——差异只会帮攻击者定位
    const cases = [
      teachingImportGuard(request(), env),
      teachingImportGuard(request("Bearer wrong"), env),
      teachingImportGuard(request("Basic x"), env),
      teachingImportGuard(request("Bearer anything"), {}),
    ];
    const bodies = await Promise.all(cases.map((response) => response?.json()));
    for (const body of bodies) {
      expect(body).toEqual({ error: "unauthorized" });
    }
  });

  it("拒绝响应不进缓存", () => {
    expect(teachingImportGuard(request(), env)?.headers.get("Cache-Control")).toBe("no-store");
  });
});
