import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { BACKUP_ACTIVITY, parseBackupActivity, type BackupRecord } from "@/lib/backup/freshness";

/**
 * 服务器上最近一次成功备份（`scripts/backup.sh` 写进 ActivityLog 的那一笔）。
 * 首页提示和设置页各取一次，同一请求只查一次
 */
export const getLastBackup = cache(async (): Promise<BackupRecord | null> => {
  const row = await prisma.activityLog.findFirst({
    where: { entityType: BACKUP_ACTIVITY.entityType, action: BACKUP_ACTIVITY.action },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, detail: true, createdAt: true },
  });
  return row ? parseBackupActivity(row) : null;
});
