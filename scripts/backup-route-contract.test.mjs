import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const routePath = "app/api/backup/route.ts";
const route = readFileSync(resolve(root, routePath), "utf8");

/**
 * 全库备份接口的静态安全契约（增量 3.8）。
 *
 * 这个端点一次就能拿走全部真实履历，是全系统最高价值的目标。下面几条锁的是
 * **顺序**——三道闸门写全了但顺序错了，等于没写。
 */
describe("全库备份接口的安全契约", () => {
  it("会话闸门在最前，早于读取请求体", () => {
    // 二次口令是叠加的第二道，不是替代。少了会话闸门，
    // 没登录的人也能直接冲这个端点爆破口令
    expect(route).toMatch(
      /export async function POST[^]*?const denied = await sessionGuard\(\);\s*if \(denied\) return denied;/,
    );
    const guardAt = route.indexOf("sessionGuard()");
    const formAt = route.indexOf("request.formData()");
    expect(guardAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(guardAt);
  });

  it("同源检查早于读取请求体", () => {
    const originAt = route.indexOf("isSameOrigin");
    const formAt = route.indexOf("request.formData()");
    expect(originAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(originAt);
  });

  it("口令校验走 timing-safe 的 verifyPasscode", () => {
    // 别改成 === 比较：那会按字符逐个短路，泄漏时序
    expect(route).toContain("verifyPasscode");
    expect(route).not.toMatch(/passcode\s*===\s*process\.env/);
  });

  it("只开 POST，不开 GET", () => {
    // GET 会被浏览器预取、进历史、进 Referer，而口令必须在请求体里
    expect(route).toMatch(/export async function POST/);
    expect(route).not.toMatch(/export async function GET/);
  });

  it("口令失败留痕，且不记录输入值", () => {
    expect(route).toContain("backup.passcode_failed");
    // 把猜错的口令存进数据库，等于给下一个拿到备份的人一份字典
    expect(route).not.toMatch(/passcode_failed[^]*?passcode\s*[,}]/);
  });

  it("先记审计再出流", () => {
    // 流一旦开始写就没有事务可言。「记了但下载失败」好过「下载了但没记」
    const auditAt = route.indexOf("backup.download");
    const streamAt = route.indexOf("new ReadableStream");
    expect(auditAt).toBeGreaterThan(-1);
    expect(streamAt).toBeGreaterThan(auditAt);
  });

  it("不设 Content-Length，并禁用缓存", () => {
    // 只匹配真正的 header 赋值，别把解释「为什么不设」的注释也算进来
    expect(route).not.toMatch(/["']Content-Length["']\s*:/);
    expect(route).toContain("private, no-store");
    expect(route).toContain("nosniff");
  });
});
