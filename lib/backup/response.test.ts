import { describe, expect, it } from "vitest";
import { isBackupPayload, isSessionRedirect } from "./response";

/**
 * 这组测试锁的是一个实测发现的坑：`proxy.ts` 对未登录请求返回 **307 重定向**
 * 而不是 401，连 `/api/*` 也一样。fetch 默认跟随重定向，于是
 * `response.ok === true` 而内容是登录页 HTML——会话一过期，用户下载到的
 * 就是一个后缀 .json 的网页，还以为备份成功了。
 */

describe("会话失效重定向", () => {
  it("认出 manual 模式下的不透明重定向", () => {
    // 同源 + redirect: "manual" 的实际形态：type=opaqueredirect、status=0
    expect(isSessionRedirect({ type: "opaqueredirect", status: 0 })).toBe(true);
  });

  it("认出 307", () => {
    // 实测 proxy.ts 未登录时正是 307 → /login?from=%2Fapi%2Fbackup
    expect(isSessionRedirect({ type: "default", status: 307 })).toBe(true);
  });

  it("认出其余 3xx", () => {
    expect(isSessionRedirect({ type: "default", status: 302 })).toBe(true);
    expect(isSessionRedirect({ type: "default", status: 308 })).toBe(true);
  });

  it("不把正常响应当成重定向", () => {
    expect(isSessionRedirect({ type: "basic", status: 200 })).toBe(false);
  });

  it("不把口令错误当成会话失效", () => {
    // 401 要显示「口令不正确」，而不是让用户去重新登录
    expect(isSessionRedirect({ type: "basic", status: 401 })).toBe(false);
    expect(isSessionRedirect({ type: "basic", status: 403 })).toBe(false);
  });
});

describe("备份负载判定", () => {
  it("接受 JSON", () => {
    expect(isBackupPayload("application/json; charset=utf-8")).toBe(true);
    expect(isBackupPayload("Application/JSON")).toBe(true);
  });

  it("拒绝 HTML", () => {
    // 登录页就是 text/html。把它存成 .json 是这个功能最隐蔽的失败方式
    expect(isBackupPayload("text/html; charset=utf-8")).toBe(false);
  });

  it("拒绝缺失的 Content-Type", () => {
    expect(isBackupPayload(null)).toBe(false);
  });
});
