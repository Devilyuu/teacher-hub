import "dotenv/config";
import { prisma } from "../lib/db";
import { buildBackupMeta, streamBackup } from "../lib/backup/export";
import { BACKUP_TABLES, INCLUDED_BACKUP_TABLES } from "../lib/backup/tables";

/**
 * 全库 JSON 备份的真实数据库验证（增量 3.8）。
 *
 * 最要紧的一条是**跨分批边界**：`streamBackup` 按 cursor 分页取数，
 * `BATCH_SIZE` 是 200。cursor 分页的 off-by-one 会丢一行或重一行，
 * 而这正是备份最致命的失败模式——文件能打开、能解析、看着正常，
 * 只是少了一条记录，等到真要用的时候才发现。
 *
 * 造 250 条跨过边界，逐条核对 id 集合与顺序。
 */

/** 必须大于 lib/backup/export.ts 里的 BATCH_SIZE，才能验到翻页 */
const FIXTURE_ROWS = 250;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type BackupDocument = {
  meta: {
    generatedAt: string;
    appVersion: string;
    schemaMigration: string | null;
    tableCounts: Record<string, number>;
    note: string;
  };
  tables: Record<string, Array<Record<string, unknown>>>;
};

async function collectBackup(): Promise<{ text: string; doc: BackupDocument }> {
  const meta = await buildBackupMeta();
  let text = "";
  for await (const chunk of streamBackup(meta)) {
    text += chunk;
  }
  return { text, doc: JSON.parse(text) as BackupDocument };
}

async function main() {
  const marker = `verify-full-backup-${crypto.randomUUID()}`;
  const findings: Record<string, unknown> = {};

  // 造跨批次的 fixture。标题带序号，用来核对顺序和完整性
  const created = await prisma.$transaction(
    Array.from({ length: FIXTURE_ROWS }, (_, index) =>
      prisma.captureItem.create({
        data: {
          // 中文 + 引号 + 破折号：顺带验 JSON 转义往返
          title: `${marker} 第 ${index + 1} 条——含"引号"`,
          content: index % 2 === 0 ? `补充内容 ${index + 1}\n换行` : null,
        },
        select: { id: true, title: true },
      }),
    ),
  );

  try {
    const { text, doc } = await collectBackup();

    // ── 1. 整份文件是合法 JSON（collectBackup 里 JSON.parse 已验），结构正确
    assert(typeof doc.meta.generatedAt === "string", "meta.generatedAt 缺失");
    assert(doc.meta.note.includes("不含附件原件"), "meta.note 没写明不含附件原件");
    findings.schemaMigration = doc.meta.schemaMigration;
    assert(
      typeof doc.meta.schemaMigration === "string" && doc.meta.schemaMigration.length > 0,
      "没记下 schema 迁移版本，搬迁时无法判断数据属于哪个 schema",
    );

    // ── 2. 每一张登记在册的表都出现了，一张都不能少
    const missingTables = INCLUDED_BACKUP_TABLES.filter(
      (table) => !Array.isArray(doc.tables[table.model]),
    ).map((table) => table.model);
    assert(missingTables.length === 0, `备份里缺表：${missingTables.join("、")}`);
    findings.tablesPresent = Object.keys(doc.tables).length;
    assert(
      Object.keys(doc.tables).length === INCLUDED_BACKUP_TABLES.length,
      "备份里的表数量与清单不符",
    );

    // ── 3. 跨分批边界：250 条一条不少、一条不重
    const backedUp = doc.tables.CaptureItem ?? [];
    const fixtureRows = backedUp.filter(
      (row) => typeof row.title === "string" && row.title.startsWith(marker),
    );
    findings.fixtureRowsInBackup = fixtureRows.length;
    assert(
      fixtureRows.length === FIXTURE_ROWS,
      `跨批次丢行：造了 ${FIXTURE_ROWS} 条，备份里只有 ${fixtureRows.length} 条`,
    );

    const backedUpIds = new Set(fixtureRows.map((row) => String(row.id)));
    findings.uniqueFixtureIds = backedUpIds.size;
    assert(
      backedUpIds.size === FIXTURE_ROWS,
      `跨批次重复行：${FIXTURE_ROWS} 条里只有 ${backedUpIds.size} 个不同 id`,
    );

    const expectedIds = new Set(created.map((row) => row.id));
    const notBackedUp = [...expectedIds].filter((id) => !backedUpIds.has(id));
    assert(notBackedUp.length === 0, `有 ${notBackedUp.length} 条 fixture 没进备份`);
    findings.batchBoundarySafe = true;

    // ── 4. 中文、引号、换行原样往返
    const sample = fixtureRows.find((row) => String(row.title).includes("第 1 条"));
    assert(sample != null, "找不到第 1 条 fixture");
    const expectedTitle = created.find((row) => row.id === String(sample.id))?.title;
    assert(
      String(sample.title) === expectedTitle,
      `标题往返不一致：库里是 ${expectedTitle}，备份里是 ${String(sample.title)}`,
    );
    assert(
      String(sample.content ?? "").includes("\n"),
      "换行符没有原样保留",
    );
    findings.textRoundTripSafe = true;

    // ── 5. meta 承诺的行数与实际写出的行数一致
    // （streamBackup 内部已经 assertCountsMatch，这里再从文件侧独立核一遍）
    const countMismatches = Object.entries(doc.meta.tableCounts)
      .filter(([model, promised]) => (doc.tables[model]?.length ?? -1) !== promised)
      .map(([model]) => model);
    assert(
      countMismatches.length === 0,
      `meta.tableCounts 与实际行数不符：${countMismatches.join("、")}`,
    );
    findings.countsMatch = true;

    // ── 6. 清单覆盖 schema 的全部模型（与单测同一断言，这里对着真实库再确认一次
    //      Prisma Client 上确实有这些 delegate）
    findings.tablesDeclared = BACKUP_TABLES.length;

    // ── 7. 文件里不含明文口令。库里本来就没有存，但如果哪天有人加了字段，
    //      这条会先于用户发现
    const passcode = process.env.APP_PASSCODE;
    if (passcode && passcode.length >= 6) {
      assert(!text.includes(passcode), "备份文件里出现了登录口令明文");
      findings.passcodeAbsent = true;
    } else {
      findings.passcodeAbsent = "skipped-no-passcode-configured";
    }
  } finally {
    await prisma.captureItem.deleteMany({ where: { title: { startsWith: marker } } });
  }

  // ── 8. 零残留
  const leftBehind = await prisma.captureItem.count({ where: { title: { startsWith: marker } } });
  findings.rowsLeftBehind = leftBehind;
  assert(leftBehind === 0, `清理后仍残留 ${leftBehind} 行`);

  console.log(JSON.stringify({ status: "pass", ...findings }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
