import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const TEACHING_VARS = ["TEACHING_APP_URL", "TEACHING_IMPORT_TOKEN"];

/**
 * 备课系统对接的部署配置契约（增量 3.6）。
 *
 * 这两条锁的是一个**只在真跑时才暴露**的缺口：3.6 交付时，代码读
 * `process.env.TEACHING_APP_URL`，`.env` 也能填，但 `docker-compose.yml` 的
 * `environment:` 块里没列它——compose 只把显式声明的变量传进容器，`.env`
 * 仅用于插值。于是填了等于没填，教学页一直显示「还没接上备课系统」，
 * **不报错、不告警**，看起来像功能没做。2026-08-07 接子域名时才发现。
 *
 * 同类保护见 `minutes-config-contract.test.mjs`。新增任何"代码读环境变量"的
 * 对接能力时，都要补上这两条断言。
 */
describe("备课系统对接的部署配置", () => {
  test("两个变量都在 .env.example 里有文档，且不是 NEXT_PUBLIC_", () => {
    const example = read(".env.example");
    for (const name of TEACHING_VARS) {
      expect(example).toContain(`${name}=`);
      // 令牌与地址都只在服务端用；带 NEXT_PUBLIC_ 前缀会被打进客户端包
      expect(name.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  test("两个变量都传进了生产 app 容器", () => {
    const compose = read("docker-compose.yml");
    for (const name of TEACHING_VARS) {
      expect(compose).toContain(`${name}: \${${name}:-}`);
    }
  });

  test("部署文档的环境变量清单里也列了", () => {
    const deploy = read("docs/deploy.md");
    for (const name of TEACHING_VARS) {
      expect(deploy).toContain(name);
    }
  });
});
