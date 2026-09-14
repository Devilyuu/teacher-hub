import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { INCLUDED_BACKUP_TABLES, cursorFieldOf, type BackupTable } from "@/lib/backup/tables";
import {
  BACKUP_NOTE,
  assertCountsMatch,
  closeDocument,
  closeTable,
  openDocument,
  openTable,
  serializeRow,
  type BackupMeta,
} from "@/lib/backup/serialize";

/**
 * 全库 JSON 备份的取数与流式输出（增量 3.8，设计见
 * `docs/superpowers/specs/2026-08-05-full-database-json-backup-design.md`）。
 */

/**
 * 每批取多少行。
 *
 * 个人数据量（几十个课题、几百条成果）随便怎么写都不会出事，但
 * `MeetingRecording.transcript` 是不设上限的长文本——2 小时的会议转写稿单条
 * 就可能上百 KB，一次 `findMany` 全表 load 再 stringify 是能预见的坑
 */
const BATCH_SIZE = 200;

type BackupDelegate = {
  count: (args?: unknown) => Promise<number>;
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
};

function delegateFor(name: string): BackupDelegate {
  const delegate = (prisma as unknown as Record<string, BackupDelegate | undefined>)[name];
  if (!delegate) {
    // 清单和 Prisma Client 对不上。`tables.test.ts` 拿 schema 比对过一次，
    // 走到这里说明 client 没重新生成——报人话，别丢 undefined.count is not a function
    throw new Error(`Prisma Client 上没有 ${name}，请先跑 prisma generate`);
  }
  return delegate;
}

function readAppVersion(): string | null {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version: unknown }).version;
      return typeof version === "string" ? version : null;
    }
    return null;
  } catch {
    // standalone 构建里 package.json 不一定在 cwd。版本号只是参考信息，
    // 拿不到就留空，**不能让整个备份因此失败**
    return null;
  }
}

/** 最后一个跑完的迁移名 */
async function readSchemaMigration(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

export async function buildBackupMeta(now: Date = new Date()): Promise<BackupMeta> {
  const [schemaMigration, ...counts] = await Promise.all([
    readSchemaMigration(),
    ...INCLUDED_BACKUP_TABLES.map((table) => delegateFor(table.delegate).count()),
  ]);

  const tableCounts: Record<string, number> = {};
  INCLUDED_BACKUP_TABLES.forEach((table, index) => {
    tableCounts[table.model] = counts[index] ?? 0;
  });

  return {
    generatedAt: now.toISOString(),
    appVersion: readAppVersion() ?? "unknown",
    schemaMigration,
    tableCounts,
    note: BACKUP_NOTE,
  };
}

/**
 * 按表逐批取数，边取边产出 JSON 片段。
 *
 * 用 cursor 分页而不是 skip/take：后者在大偏移时每次都要扫过前面所有行。
 * 全部模型都有 `id`，按它排序是稳定的。
 */
async function* streamTable(
  table: BackupTable,
  onRow: () => void,
): AsyncGenerator<string> {
  const delegate = delegateFor(table.delegate);
  // 主键字段名不一律是 `id`：PromotionRuleset 用 `year`
  const key = cursorFieldOf(table);
  let cursor: string | number | undefined;
  let isFirstRow = true;

  for (;;) {
    const rows = await delegate.findMany({
      take: BATCH_SIZE,
      orderBy: { [key]: "asc" },
      ...(cursor === undefined ? {} : { skip: 1, cursor: { [key]: cursor } }),
    });

    if (rows.length === 0) return;

    for (const row of rows) {
      yield serializeRow(row, isFirstRow);
      isFirstRow = false;
      onRow();
    }

    if (rows.length < BATCH_SIZE) return;

    const lastKey = rows[rows.length - 1]?.[key];
    if (typeof lastKey !== "string" && typeof lastKey !== "number") {
      // 取不到游标就不能安全翻页。**宁可抛错也不能 return**——
      // return 会悄悄截断这张表，产出一个看着正常、实际少了后半截的备份
      throw new Error(`${table.model}.${key} 不是可用的游标值，无法继续分页`);
    }
    cursor = lastKey;
  }
}

/** 产出完整备份文件的字节流 */
export async function* streamBackup(meta: BackupMeta): AsyncGenerator<string> {
  yield openDocument(meta);

  const actualCounts: Record<string, number> = {};

  for (const [index, table] of INCLUDED_BACKUP_TABLES.entries()) {
    yield openTable(table.model, index === 0);

    actualCounts[table.model] = 0;
    for await (const chunk of streamTable(table, () => {
      actualCounts[table.model] = (actualCounts[table.model] ?? 0) + 1;
    })) {
      yield chunk;
    }

    yield closeTable();
  }

  yield closeDocument();

  // 放在最后：走到这里字节已经发完了，抛错会让连接以错误收场，
  // 用户拿到的是一次失败的下载而不是一个与 meta 不符的文件
  assertCountsMatch(meta.tableCounts, actualCounts);
}
