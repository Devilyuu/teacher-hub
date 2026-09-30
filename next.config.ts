import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A linked worktree sits below another package-lock. Pinning the root keeps
  // Turbopack/NFT from walking into the parent checkout and tracing source,
  // tests, docs, or runtime data from there.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  // 桌面版（desktop/）要一份自带最小 node_modules 的 standalone 产物，
  // 由 desktop/scripts/build-server.mjs 设 TEACHER_DESK_STANDALONE=1 打开。
  // 服务器镜像不用它：Dockerfile 复制的是完整 .next + 生产依赖，多一份副本只会撑大镜像
  ...(process.env.TEACHER_DESK_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // `/materials` 是「更多」那个一级入口指向的素材占位页，二期把它整个去掉了
  // （规格 §3.3：不做独立的通用素材库，素材归入课题过程）。
  // 308 重定向到导出，避免旧书签落到 404 上。
  async redirects() {
    return [{ source: "/materials", destination: "/export", permanent: true }];
  },
  // data/ 是运行时挂载卷，docs/ 与 .env* 也不属于应用镜像。
  // 上传目录会被文件 API 读取，但它的内容必须在容器启动后由 volume 提供，
  // 不能让 Next.js output tracing 把真实履历、数据库或证书复制进构建产物。
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./docs/**/*",
      "./.env*",
      // 桌面版 standalone：追踪会把整个 lib/ 源码树（含 *.test.ts、.real.test.ts 里的学校内部规则原文）
      // 当作首页的运行时依赖复制进去。运行时根本不需要它们——服务器镜像从不复制 lib/ 照样跑。
      // **只许按扩展名排 .ts / .tsx，不许写 `./lib/**/*`**：这些规则是按「路径里包含」匹配的，
      // 写成整目录会把 node_modules/pg/lib 之类一起排掉，装到别的机器上报 Cannot find module 'pg-types'
      // （2026-09-27 打包后实测；开发机上能顺着目录往上找到仓库的 node_modules，看不出来）
      ...(process.env.TEACHER_DESK_STANDALONE === "1" ? ["./lib/**/*.ts", "./lib/**/*.tsx"] : []),
    ],
  },
  experimental: {
    // Multipart adds boundaries and headers on top of the 100 MiB audio file.
    proxyClientMaxBodySize: "105mb",
    serverActions: {
      // 默认只有 1MB，申报书带图轻松超过。与 lib/storage.ts 的
      // MAX_UPLOAD_BYTES 保持一致，留一点余量给表单其余字段
      bodySizeLimit: "26mb",
    },
  },
};

export default nextConfig;
