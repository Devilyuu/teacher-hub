import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import {
  backupFreshness,
  DESKTOP_BACKUP_STALE_AFTER_HOURS,
  formatHoursAgo,
} from "@/lib/backup/freshness";
import { prisma } from "@/lib/db";
import { isDesktopEdition } from "@/lib/edition";
import { formatTimestamp } from "@/lib/format";
import { getLastBackup } from "@/lib/queries/backup-status";

/**
 * 首页上「好久没成功备份了」那一行。**只在该提醒时出现**，平时一个字节都不占。
 *
 * 放首页是因为首页只放能被处理掉的事（CLAUDE.md），而这正是一件要处理的事：
 * 2026-09-25 评审查出备份失败没人会知道——日志在服务器的 /var/log 里，谁也不会去看。
 * 口径（服务器 36 小时、桌面版 7 天）在 lib/backup/freshness.ts。
 *
 * 两种部署的差别：服务器上一笔都没有时不报（本机开发库、刚部署的库都是这样）；
 * **桌面版一笔都没有、而库里已经有东西了，要报**——数据只在这一台电脑上，没备份过是最危险的状态。
 *
 * 不用语义色：健康度那几个色只归 health.tsx（CLAUDE.md 视觉语言）。它不常出现，
 * 出现时在问候带下面单独一块，已经够显眼
 */
export async function BackupStaleNotice() {
  const last = await getLastBackup();
  if (isDesktopEdition()) return <DesktopNotice last={last} />;

  const freshness = backupFreshness(last, new Date());
  if (freshness.state !== "stale") return null;

  return (
    <Notice>
      服务器最近一次成功备份是 {formatHoursAgo(freshness.hoursAgo)}（
      {formatTimestamp(freshness.last.completedAt)}），已经超过一天半没有新的了。日志在服务器的{" "}
      <code className="font-mono text-xs">/var/log/keticompass-backup.log</code>，
      <Link href="/settings" className="underline underline-offset-4">
        设置页
      </Link>
      有备份的说明。
    </Notice>
  );
}

async function DesktopNotice({ last }: { last: Awaited<ReturnType<typeof getLastBackup>> }) {
  const freshness = backupFreshness(last, new Date(), DESKTOP_BACKUP_STALE_AFTER_HOURS);
  if (freshness.state === "fresh") return null;
  if (freshness.state === "never") {
    // 刚装好、什么都还没录的时候不催：那时候备份的是一个空库
    const [achievement, project, task] = await Promise.all([
      prisma.achievement.findFirst({ select: { id: true } }),
      prisma.project.findFirst({ select: { id: true } }),
      prisma.task.findFirst({ select: { id: true } }),
    ]);
    if (!achievement && !project && !task) return null;
  }

  return (
    <Notice>
      {freshness.state === "never"
        ? "数据只在这台电脑上，还没备份过。"
        : `上次备份是 ${formatHoursAgo(freshness.hoursAgo)}（${formatTimestamp(freshness.last.completedAt)}）。`}
      用菜单「文件 → 备份数据」存一份，再拷到 U 盘或网盘——电脑重装系统一般只格 C 盘，可硬盘坏了什么都不剩。
    </Notice>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-well px-4 py-3">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
      <p className="measure text-sm leading-relaxed">{children}</p>
    </div>
  );
}
