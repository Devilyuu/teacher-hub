/**
 * 服务器备份新不新鲜。纯函数，查询在 `lib/queries/backup-status.ts`。
 *
 * 备份在服务器上由 cron 每天 03:20 跑 `scripts/backup.sh`，成功后往 ActivityLog 写一笔
 * `Backup / backup.completed`。平台自己不跑备份，只看最近那一笔是什么时候——
 * 2026-09-25 评审查出来：备份失败了没人知道，日志写在服务器的 /var/log 里，谁也不会去看。
 *
 * 三条口径：
 * - **超过 36 小时算过期**：每天一次，36 小时 = 正好错过一次还多留半天，不会因为某天晚跑几分钟就报警
 * - **一笔都没有时不报警**：本机开发库、刚部署还没到第一次 03:20 的线上库都是这样，
 *   报了就是狼来了。代价是「从没成功过」这种情况看不出来——线上备份已经跑了几个月，可以接受
 * - 只报事实不判定原因：页面上写「最近一次成功是什么时候」，去哪查写清楚，不猜是磁盘满了还是容器挂了
 */

/** backup.sh 写的那一笔。改名要两边一起改，契约测试锁着（freshness.test.ts） */
export const BACKUP_ACTIVITY = { entityType: "Backup", action: "backup.completed" } as const;

/** 超过这么久没有新的成功备份就提示 */
export const BACKUP_STALE_AFTER_HOURS = 36;

/**
 * 桌面版：没有 cron，靠人点「文件 → 备份数据」（desktop/src/maintenance.ts，成功后写同一笔 ActivityLog）。
 * 一周一次够了，天天催就成了狼来了
 */
export const DESKTOP_BACKUP_STALE_AFTER_HOURS = 7 * 24;

export type BackupRecord = {
  /** 写这一笔的时间，也就是备份完成的时间 */
  completedAt: Date;
  /** 备份目录名，如 `2026-09-26_0320` */
  stamp: string;
  bytes: number | null;
  tables: number | null;
  codeVersion: string | null;
};

export type BackupFreshness =
  | { state: "never" }
  | { state: "fresh" | "stale"; last: BackupRecord; hoursAgo: number };

export function backupFreshness(
  last: BackupRecord | null,
  now: Date,
  staleAfterHours: number = BACKUP_STALE_AFTER_HOURS,
): BackupFreshness {
  if (last == null) return { state: "never" };
  const hoursAgo = Math.max(0, (now.getTime() - last.completedAt.getTime()) / 3_600_000);
  return {
    state: hoursAgo > staleAfterHours ? "stale" : "fresh",
    last,
    hoursAgo,
  };
}

/** 「3 小时前」「2 天前」。只给个量级，精确时间旁边另写 */
export function formatHoursAgo(hoursAgo: number): string {
  if (hoursAgo < 1) return "不到 1 小时前";
  if (hoursAgo < 48) return `${Math.floor(hoursAgo)} 小时前`;
  return `${Math.floor(hoursAgo / 24)} 天前`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/** ActivityLog 的一行 → BackupRecord。detail 是 backup.sh 用 jsonb_build_object 写的，宽松读 */
export function parseBackupActivity(row: {
  entityId: string;
  detail: unknown;
  createdAt: Date;
}): BackupRecord {
  const detail = isRecord(row.detail) ? row.detail : {};
  return {
    completedAt: row.createdAt,
    stamp: row.entityId,
    bytes: typeof detail.bytes === "number" ? detail.bytes : null,
    tables: typeof detail.tables === "number" ? detail.tables : null,
    codeVersion: typeof detail.codeVersion === "string" ? detail.codeVersion : null,
  };
}
