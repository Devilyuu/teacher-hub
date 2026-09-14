import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 让 @/ 别名按 tsconfig.json 的 paths 解析
    tsconfigPaths: true,
    alias: {
      // `server-only` 的默认入口就是一句 throw，靠 react-server 条件才会解析成空模块。
      // vitest 不带那个条件，所以直接把它换成空实现——
      // 它的作用是在打包时拦截误引用，跑单测时没有意义
      // 必须用 fileURLToPath 而不是 .pathname：
      // Windows 上后者会得到 "/E:/..." 这种带前导斜杠、还带 URL 编码的路径
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // 业务测试放 lib/；静态部署验证器的纯 helper 测试放 scripts/。
    include: ["lib/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
