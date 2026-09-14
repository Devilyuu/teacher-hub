import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A linked worktree sits below another package-lock. Pinning the root keeps
  // Turbopack/NFT from walking into the parent checkout and tracing source,
  // tests, docs, or runtime data from there.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
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
    "/*": ["./data/**/*", "./docs/**/*", "./.env*"],
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
