import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

// Prisma 7 起运行时必须显式传 driver adapter，`new PrismaClient()` 会抛错。
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL，请参照 .env.example 配置");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// dev 模式下 Next.js 的热更新会反复求值模块，挂到 globalThis 上避免连接池泄漏。
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
