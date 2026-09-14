/**
 * 导入学校绩效规则目录到 PerfCategory（prd-ledger 2.2 / BUILD_PLAN Phase 2）。
 *
 *   npm run import:perf-rules            试运行，只打印计划与告警，不写库
 *   npm run import:perf-rules -- --apply 真正写入
 *
 * **默认试运行**，和 `import-obsidian.ts` 一个规矩：这类脚本一跑就改库，
 * 先看清楚要写什么再决定。
 *
 * 幂等：按 `(year, majorCategory, minorCategory)` upsert。学校次年发新表时，
 * 换一个 year 的 JSON 再跑一次即可，旧年度原样保留——历史成果必须仍按
 * 当年的规则解释。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { buildCatalogPlan, majorCategoriesInOrder } from "../lib/import/perf-rules";

const DEFAULT_SOURCE = "prisma/data/performance-rules-2025.json";
const apply = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.endsWith(".json"));
const source = resolve(process.cwd(), fileArg ?? DEFAULT_SOURCE);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("缺少环境变量 DATABASE_URL，请参照 .env.example 配置");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const doc = JSON.parse(readFileSync(source, "utf-8"));
  const { drafts, warnings } = buildCatalogPlan(doc);

  console.log(`来源：${doc.source}`);
  console.log(`文件：${source}`);
  console.log(`年度：${drafts[0].year}　条数：${drafts.length}\n`);

  const majors = majorCategoriesInOrder(drafts);
  console.log(`大类 ${majors.length} 个：`);
  for (const major of majors) {
    const n = drafts.filter((d) => d.majorCategory === major).length;
    console.log(`  ${String(n).padStart(3)}　${major}`);
  }

  const inactive = drafts.filter((d) => !d.isActive);
  if (inactive.length > 0) {
    console.log(`\n学校已停用 ${inactive.length} 条（照样入库，历史成果可能还挂在上面）：`);
    for (const d of inactive) console.log(`  ${d.majorCategory} / ${d.minorCategory}`);
  }

  if (warnings.length > 0) {
    console.log(`\n告警 ${warnings.length} 条：`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (!apply) {
    console.log("\n试运行结束，未写库。确认无误后加 -- --apply 执行。");
    return;
  }

  let created = 0;
  let updated = 0;
  for (const draft of drafts) {
    const { year, majorCategory, minorCategory, ...rest } = draft;
    const existing = await prisma.perfCategory.findUnique({
      where: {
        year_majorCategory_minorCategory: { year, majorCategory, minorCategory },
      },
      select: { id: true },
    });
    await prisma.perfCategory.upsert({
      where: {
        year_majorCategory_minorCategory: { year, majorCategory, minorCategory },
      },
      create: draft,
      update: rest,
    });
    if (existing) updated += 1;
    else created += 1;
  }

  const total = await prisma.perfCategory.count({ where: { year: drafts[0].year } });
  console.log(`\n已写入：新增 ${created} 条，更新 ${updated} 条。`);
  console.log(`${drafts[0].year} 年度现有 ${total} 条规则。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
