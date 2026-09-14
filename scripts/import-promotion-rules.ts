/**
 * 导入人事处《业绩量化考核表》到 PromotionCategory / PromotionRuleset。
 *
 *   npm run import:promotion-rules            试运行，只打印计划与校验，不写库
 *   npm run import:promotion-rules -- --apply 真正写入
 *
 * **默认试运行**，和其余导入脚本一个规矩：这类脚本一跑就改库，
 * 先看清楚要写什么再决定。
 *
 * 幂等：按 `(year, code)` upsert。人事处次年发新表时，换一个 year 的 JSON
 * 再跑一次即可，旧年度原样保留——历史成果必须仍按当年的表解释。
 *
 * 注意这张表与 PerfCategory 是**两套坐标系**，不是一套的两种叫法：
 * 那张是二级学院分钱用的，这张是人事处评职称用的（schema 里有详细说明）。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  buildPromotionPlan,
  majorIndicatorsInOrder,
  SERIES_LABELS,
  type TitleSeriesValue,
} from "../lib/import/promotion-rules";

const DEFAULT_SOURCE = "prisma/data/promotion-rules-2026.json";
const apply = process.argv.includes("--apply");
const fileArg = process.argv.find((a) => a.endsWith(".json"));
const source = resolve(process.cwd(), fileArg ?? DEFAULT_SOURCE);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("缺少环境变量 DATABASE_URL，请参照 .env.example 配置");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function seriesMark(appliesTo: TitleSeriesValue[]): string {
  const order: TitleSeriesValue[] = ["TEACHER", "LAB", "IDEOLOGY", "EDU_ADMIN"];
  // 沿用附件1 的记号，一眼能和原件对上
  return order.map((s) => (appliesTo.includes(s) ? "●" : "◌")).join("");
}

async function main() {
  const doc = JSON.parse(readFileSync(source, "utf-8"));
  const { head, drafts, warnings, checks } = buildPromotionPlan(doc);

  console.log(`来源：${head.source}`);
  console.log(`文件：${source}`);
  console.log(`年度：${head.year}　二级指标：${drafts.length} 条\n`);

  const majors = majorIndicatorsInOrder(drafts);
  console.log(`一级指标 ${majors.length} 个：`);
  for (const major of majors) {
    const rows = drafts.filter((d) => d.majorIndicator === major);
    console.log(
      `  ${String(rows.length).padStart(2)} 项　${major}（封顶 ${rows[0].majorCap} 分）`,
    );
  }

  console.log(`\n逐条（系列记号顺序：${Object.values(SERIES_LABELS).join(" / ")}）：`);
  for (const d of drafts) {
    const cap = d.cap == null ? "—" : `${d.cap}`;
    const shared = d.capGroup === d.code ? "" : `（与 ${d.capGroup} 共用）`;
    console.log(
      `  ${d.code.padEnd(5)} ${seriesMark(d.appliesTo)}  上限 ${cap.padStart(4)}${shared}  ${d.minorIndicator}`,
    );
    if (d.capNote) console.log(`         ↳ ${d.capNote}`);
  }

  console.log("\n封顶校验（这是判断 PDF 里散落的备注有没有配错指标的唯一依据）：");
  for (const c of checks) {
    console.log(
      `  ${c.ok ? "✓" : "✗"} ${c.label}：附件写 ${c.expected}，各栏封顶相加 ${c.actual}`,
    );
  }

  console.log(`\n整表说明 ${head.generalNotes.length} 条（填分时要照着看）：`);
  head.generalNotes.forEach((note, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${note.slice(0, 60)}${note.length > 60 ? "…" : ""}`);
  });

  if (warnings.length > 0) {
    console.log(`\n告警 ${warnings.length} 条：`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  } else {
    console.log("\n无告警。");
  }

  if (!apply) {
    console.log("\n试运行结束，未写库。确认无误后加 -- --apply 执行。");
    return;
  }

  await prisma.promotionRuleset.upsert({
    where: { year: head.year },
    create: head,
    update: { ...head, year: undefined },
  });

  let created = 0;
  let updated = 0;
  for (const draft of drafts) {
    const { year, code, ...rest } = draft;
    const existing = await prisma.promotionCategory.findUnique({
      where: { year_code: { year, code } },
      select: { id: true },
    });
    await prisma.promotionCategory.upsert({
      where: { year_code: { year, code } },
      create: draft,
      update: rest,
    });
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(`\n已写入：新建 ${created} 条，更新 ${updated} 条。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
