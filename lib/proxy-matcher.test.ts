import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * proxy.ts 的 `config.matcher` 必须是文件里的字面量（Next 静态分析它），
 * 没法 import，所以从源码里把它抠出来再当正则跑。
 * matcher 的形状是 `/((?!…).*)`，Next 用 path-to-regexp 解释：
 * 括号里是一段自定义正则，从第一个 `/` 之后开始匹配整条路径。
 */
function loadMatcher(): RegExp {
  const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const match = source.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/);
  if (!match) throw new Error("proxy.ts 里找不到 config.matcher");
  const literal = JSON.parse(`"${match[1]}"`) as string;
  const inner = literal.match(/^\/\((.*)\)$/);
  if (!inner) throw new Error(`matcher 形状变了：${literal}`);
  return new RegExp(`^/${inner[1]}$`);
}

const matcher = loadMatcher();
const goesThroughProxy = (pathname: string) => matcher.test(pathname);

describe("proxy matcher", () => {
  it("根目录的图标与 _next 静态资源不经 proxy", () => {
    for (const path of [
      "/favicon.ico",
      "/icon.png",
      "/apple-icon.png",
      "/_next/static/chunks/main.js",
      "/_next/image",
    ]) {
      expect(goesThroughProxy(path), path).toBe(false);
    }
  });

  it("子路径下以图片后缀结尾的路径照样经 proxy（不能拿后缀绕过鉴权）", () => {
    for (const path of [
      "/api/attachments/abc.png",
      "/api/attachments/abc.svg",
      "/projects/abc.png",
      "/tasks/x.svg",
      "/students/a/b.jpg",
      "/api/backup/x.ico",
    ]) {
      expect(goesThroughProxy(path), path).toBe(true);
    }
  });

  it("普通页面与接口都经 proxy", () => {
    for (const path of ["/", "/projects", "/projects/abc", "/api/attachments/abc", "/login"]) {
      expect(goesThroughProxy(path), path).toBe(true);
    }
  });
});
