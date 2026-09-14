import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 生成物与 shadcn/ui 原样引入的组件，不按本项目规则约束
    "lib/generated/**",
    "components/ui/**",
    /**
     * git worktree 目录。
     *
     * 上面那条 `.next/**` 只匹配仓库根下的构建产物，匹配不到
     * `.worktrees/<name>/.next/`——在 worktree 里跑过一次 `npm run build`，
     * 主目录的 lint 就会去扫它编译出来的 chunk，报出一堆 `require()`、
     * `@ts-ignore` 之类根本不是本项目源码的问题（实测 17 条）。
     *
     * worktree 里的源码由它自己那份 lint 负责，主目录不必重复扫。
     */
    ".worktrees/**",
  ]),
  {
    rules: {
      /**
       * `_` 前缀表示「签名要求它在，但这里用不上」。
       *
       * 默认的 `args: "after-used"` 只报尾部未用参数，所以
       * `(_prev, formData)` 一直不报、`(id, _prev, _formData)` 却报——
       * 同一个约定时灵时不灵。Server Action 里这种形状很常见
       * （`useActionState` 规定了参数，动作本身不读它们），统一豁免。
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
