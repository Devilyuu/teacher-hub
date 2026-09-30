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
     * git worktree 目录：`.worktrees/`（codex 用）与 `.claude/worktrees/`（Claude Code 用）。
     *
     * 上面那条 `.next/**` 只匹配仓库根下的构建产物，匹配不到
     * `.worktrees/<name>/.next/`——在 worktree 里跑过一次 `npm run build`，
     * 主目录的 lint 就会去扫它编译出来的 chunk，报出一堆 `require()`、
     * `@ts-ignore` 之类根本不是本项目源码的问题（实测 17 条）。
     *
     * `.claude/` 是同一个坑的放大版：flat config 默认**不**忽略点开头的目录，
     * 某个 `.claude/worktrees/<name>/` 里开过 `next dev`，它的 `.next/dev/**`
     * 就被整个扫进来——实测 6388 个问题、553 个 error，**全部**来自那里，
     * 全量 `npm run lint` 因此没法当发布门禁用。`.claude/` 下其余内容
     * （launch.json、本地设置、第三方 skills）也都不是项目源码，整目录忽略。
     *
     * worktree 里的源码由它自己那份 lint 负责，主目录不必重复扫。
     */
    ".worktrees/**",
    ".claude/**",
    // 本地脚本的落盘产物（迁移盘点 JSON、演示截图），不是源码
    "output/**",
    // 桌面版（desktop/）有自己的 package.json 与 tsconfig，依赖不在根 node_modules 里，
    // 根目录的 lint 与 typecheck 都不管它（tsconfig.json 同样把它排除了）
    "desktop/**",
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
