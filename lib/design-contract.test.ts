import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 设计契约与源头的一致性门禁（规格 §7.7）。
 *
 * `docs/design-contract/tokens.css` 是给备课系统复制的那一份。它和
 * `app/globals.css` 漂移了却没人发现，正是"点过去像换了个产品"的起点——
 * 而那恰恰是 §7.7 要防的唯一一件事。漂移不会报错，只会慢慢变得不像，
 * 所以只能靠机器盯。
 */

const root = process.cwd();
const globals = readFileSync(join(root, "app", "globals.css"), "utf8");
const contract = readFileSync(join(root, "docs", "design-contract", "tokens.css"), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 取出某个选择器块的内容（按花括号配对，跳过嵌套） */
function selectorBlock(source: string, selector: string): string {
  const clean = stripComments(source);
  const start = clean.indexOf(`${selector} {`);
  if (start === -1) return "";

  let depth = 0;
  for (let index = clean.indexOf("{", start); index < clean.length; index += 1) {
    if (clean[index] === "{") depth += 1;
    else if (clean[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return clean.slice(clean.indexOf("{", start) + 1, index);
      }
    }
  }
  return "";
}

/** 值里的换行和连续空格都归一化——多行阴影两边写法不同不算漂移 */
function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cssVariables(source: string, selector: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const match of selectorBlock(source, selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    variables.set(match[1]!, normalize(match[2]!));
  }
  return variables;
}

const selectors = [":root", ".dark"] as const;

describe("设计契约", () => {
  it.each(selectors)("%s 的令牌是 globals.css 的子集", (selector) => {
    const source = cssVariables(globals, selector);
    const shared = cssVariables(contract, selector);

    expect(shared.size, `${selector} 里一个令牌都没提取到，解析大概坏了`).toBeGreaterThan(10);

    const missing = [...shared.keys()].filter((name) => !source.has(name));
    expect(missing, `契约里有 globals.css 没有的令牌：${missing.join("、")}`).toEqual([]);
  });

  it.each(selectors)("%s 的令牌值与 globals.css 一致", (selector) => {
    const source = cssVariables(globals, selector);
    const shared = cssVariables(contract, selector);

    const drifted = [...shared.entries()]
      .filter(([name, value]) => source.get(name) !== value)
      .map(([name]) => name);

    expect(
      drifted,
      `契约与源头的值漂移了：${drifted.join("、")}。改了 globals.css 就要同步 tokens.css 并升版本号`,
    ).toEqual([]);
  });

  it("契约带版本号", () => {
    // 备课系统靠它判断自己复制的是哪一版
    expect(contract).toMatch(/contract-version:\s*\d+\.\d+\.\d+/);
  });

  it("README 的版本号与 tokens.css 一致", () => {
    // 2.0.0 上线时令牌升了、README 还写着 22px 墨黑顶部导航，后来的人面对
    // 两份互相矛盾的「权威规范」。版本号对不上几乎总意味着 README 没跟着改
    const readme = readFileSync(join(root, "docs", "design-contract", "README.md"), "utf8");
    const tokenVersion = contract.match(/contract-version:\s*(\d+\.\d+\.\d+)/)?.[1];
    const readmeVersion = readme.match(/^#\s*设计契约\s*·\s*v(\d+\.\d+\.\d+)/m)?.[1];
    expect(readmeVersion, "README 标题里没找到「设计契约 · vX.Y.Z」").toBeDefined();
    expect(
      readmeVersion,
      `README 是 v${readmeVersion}、tokens.css 是 ${tokenVersion}：改了令牌就要同步 README 的规则和版本号`,
    ).toBe(tokenVersion);
  });

  it("覆盖视觉语言里那几条硬规则涉及的令牌", () => {
    const light = cssVariables(contract, ":root");
    const dark = cssVariables(contract, ".dark");

    // 卡片形状的三档阴影，缺一个就传达不了
    for (const name of ["--card-shadow", "--card-shadow-hover", "--pill-shadow"]) {
      expect(light.has(name), `浅色缺 ${name}`).toBe(true);
      expect(dark.has(name), `深色缺 ${name}`).toBe(true);
    }

    // 圆角与主色是形状和品牌的根
    expect(light.get("--radius")).toBe("0.875rem");
    expect(light.has("--primary")).toBe(true);

    // ── 深色的三条规矩（2026-09-12 改版时三条全踩过一遍）──────────

    // 1. **画布中性，不跟主色走。** 浅色画布带一点青是"纸的凉意"，
    //    同样的色相放到近黑上就是一层泥——青绿会变墨绿，整屏发脏。
    //    近黑的三个通道必须彼此接近，拉开就是染上色相了
    const channels = dark.get("--background")!.match(/^#(\w{2})(\w{2})(\w{2})$/);
    expect(channels, "深色画布得是 hex，下面这条要按通道算").not.toBeNull();
    const [r, g, b] = channels!.slice(1).map((hex) => Number.parseInt(hex, 16));
    expect(
      Math.max(r!, g!, b!) - Math.min(r!, g!, b!),
      "深色画布染上了色相——近黑配青绿等于墨绿，这是改版时踩的第一个坑",
    ).toBeLessThanOrEqual(8);

    // 2. **--well 在深色下要比卡片亮，不是暗。** 浅色的 well 是凹槽
    //    （比白卡暗），直译到深色就成了一个洞。半透明白叠在卡片上提亮、
    //    叠在画布上也提亮，一份定义两处都对
    expect(
      dark.get("--well"),
      "深色的 --well 必须半透明才叠得出层次，实色会变成一个洞",
    ).toMatch(/\/\s*\d/);

    // 3. **边只画一层。** 卡片自己有 1px border，阴影里再写 0 0 0 1px
    //    就是两条边叠着画，深色下看起来每张卡都糊了一圈
    expect(
      dark.get("--card-shadow"),
      "深色阴影里混进了描边，和卡片自己的 border 会叠成两层",
    ).not.toMatch(/0 0 0 1px/);

    // 浮层必须不透明，否则盖在表格上会漏出下面的行
    expect(dark.get("--popover")).not.toMatch(/\//);

    // 装饰色板的底片必须是低透明度的。它一旦实心化就和语义色的
    // "实心圆点"撞了形态——而本平台正是靠这层形态差异，才让彩色功能图标
    // 和健康度语义色在同一屏里共存（globals.css 文件头）
    for (const name of ["--decor-blue-bg", "--decor-rose-bg", "--decor-amber-bg"]) {
      expect(light.get(name), `${name} 得是半透明底片，不能实心`).toMatch(
        /\/\s*1?\d%/,
      );
    }
  });

  it("不把 Tailwind 的构建细节泄进契约", () => {
    // --color-* 是本项目 @theme 的映射，备课系统未必用 Tailwind。
    // 把它抄过去等于强加一套构建方式
    const light = cssVariables(contract, ":root");
    const leaked = [...light.keys()].filter((name) => name.startsWith("--color-"));
    expect(leaked).toEqual([]);
  });
});
