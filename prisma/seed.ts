/**
 * 种子数据。**只建所有人都用得上的通用分类**，不建任何人的档案和课题。
 *
 * 个人数据（档案、立项来源、有通知原文支撑的课题）放在 `prisma/data/seed-personal.ts`：
 * 那个目录不进开源导出，这里发现文件存在才调用。开源版的使用者种子跑完是一个空台账，
 * 立项来源在新建课题时现场添加；想先看看样子，用 `npm run demo:reset` 灌虚构演示数据。
 *
 * 可重复执行：按 name 做 upsert，重跑不会产生重复行。
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("缺少环境变量 DATABASE_URL，请参照 .env.example 配置");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DOC_CATEGORIES = [
  { name: "人才培养方案", sortOrder: 10 },
  { name: "课程标准", sortOrder: 20 },
  { name: "申报参考", sortOrder: 30 },
  { name: "制度文件", sortOrder: 40 },
  { name: "其他", sortOrder: 50 },
];

async function seedDocCategories() {
  for (const category of DOC_CATEGORIES) {
    await prisma.docCategory.upsert({
      where: { name: category.name },
      create: category,
      update: { sortOrder: category.sortOrder },
    });
  }
  return prisma.docCategory.count();
}

/** 私有仓库里才有的个人种子。路径拼出来再动态导入：开源版没有这个文件，类型检查也不该去找它 */
const PERSONAL_SEED = resolve(import.meta.dirname, "data", "seed-personal.ts");

async function seedPersonalIfPresent(): Promise<string[]> {
  if (!existsSync(PERSONAL_SEED)) return [];
  const personal = (await import(pathToFileURL(PERSONAL_SEED).href)) as {
    seedPersonal: (client: PrismaClient) => Promise<string[]>;
  };
  return personal.seedPersonal(prisma);
}

async function main() {
  const docCategoryCount = await seedDocCategories();
  const personalLines = await seedPersonalIfPresent();

  console.log("种子数据写入完成：");
  console.log(`  常用文档分类  ${docCategoryCount} 类`);
  for (const line of personalLines) console.log(line);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
