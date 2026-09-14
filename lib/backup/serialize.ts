/**
 * 全库备份 JSON 的流式拼装（设计见
 * `docs/superpowers/specs/2026-08-05-full-database-json-backup-design.md`）。
 *
 * 这里全是纯函数，不碰数据库——**为的是能把"生成的字节是不是合法 JSON"
 * 单测掉**。手写流式 JSON 最容易错在逗号：第一张表前面不能有逗号、
 * 最后一行后面不能有逗号，错一个字符整份文件就解析不了，
 * 而那时数据已经下载到用户机器上了。
 */

/** 附件原件不在 JSON 里，这句话必须同时出现在文件和界面上 */
export const BACKUP_NOTE = "本文件只含业务数据，不含附件原件；附件原件由 scripts/backup.sh 备份。";

export type BackupMeta = {
  /** 生成时刻（ISO 8601 UTC） */
  generatedAt: string;
  appVersion: string;
  /**
   * 最后一个已应用的迁移名。搬迁时第一个要问的问题是"这份数据是哪个 schema 版本"，
   * 文件名里的日期答不了它
   */
  schemaMigration: string | null;
  /** 各表行数，取自生成开始时刻 */
  tableCounts: Record<string, number>;
  note: string;
};

/** `teacher-desk-backup-2026-08-05.json` */
export function backupFileName(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `teacher-desk-backup-${year}-${month}-${day}.json`;
}

export function openDocument(meta: BackupMeta): string {
  return `{"meta":${JSON.stringify(meta)},"tables":{`;
}

/** `isFirst` 为假时前面补逗号——表之间的分隔符只能由调用方决定 */
export function openTable(model: string, isFirst: boolean): string {
  return `${isFirst ? "" : ","}${JSON.stringify(model)}:[`;
}

export function serializeRow(row: unknown, isFirst: boolean): string {
  return `${isFirst ? "" : ","}${JSON.stringify(row)}`;
}

export function closeTable(): string {
  return "]";
}

export function closeDocument(): string {
  return "}}";
}

/**
 * meta 里承诺的行数与实际写出的行数不一致时抛错。
 *
 * **宁可让下载失败，也不给一个内容与 meta 不符的文件**——同材料 ZIP 那条
 * 「不留下看着完整、实际截断的包」。meta 在文件开头、流已经发出去了改不了，
 * 所以只能让连接以错误收场。
 */
export function assertCountsMatch(
  promised: Record<string, number>,
  actual: Record<string, number>,
): void {
  const mismatched = Object.keys(promised).filter((model) => promised[model] !== actual[model]);
  if (mismatched.length > 0) {
    const detail = mismatched
      .map((model) => `${model}: 承诺 ${promised[model]}、实际 ${actual[model] ?? 0}`)
      .join("；");
    throw new Error(`备份行数与元数据不一致（${detail}）`);
  }
}
