import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * Node 版本只认 .nvmrc 一处（2026-09-26）。原来 CI 和 Dockerfile 各写一个 24，
 * 哪天有一处升了别处不知道（09-14 审计）。CI 已改成 node-version-file: .nvmrc；
 * Dockerfile 的 FROM 在这里对齐。
 *
 * **package.json 刻意不加 engines。** 09-26 加过一次：package.json 一动，Docker 的依赖层缓存
 * 就失效，服务器得重新从 npm 官方源下全部依赖——而腾讯云到 registry.npmjs.org 那天慢到
 * 元数据请求 15 秒超时，构建卡在 npm ci 二十分钟，只好撤掉。等哪次本来就要动依赖时再加
 */
const major = readFileSync(".nvmrc", "utf8").trim();

describe("Node 版本只有一个来源", () => {
  test(".nvmrc 写的是一个主版本号", () => {
    expect(major).toMatch(/^\d+$/);
  });

  test("Dockerfile 每个阶段的基础镜像都是这个主版本", () => {
    const froms = [...readFileSync("Dockerfile", "utf8").matchAll(/^FROM node:(\d+)[-\w.]*/gm)].map(
      (match) => match[1],
    );
    expect(froms.length).toBeGreaterThan(0);
    expect(new Set(froms)).toEqual(new Set([major]));
  });

  test("CI 从 .nvmrc 读版本，不再写死", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).not.toMatch(/node-version:\s*\d/);
    expect(ci.match(/node-version-file: \.nvmrc/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
