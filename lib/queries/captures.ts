import "server-only";
import { pendingCaptures } from "@/lib/capture";
import { prisma } from "@/lib/db";
import type { InboxCapture } from "@/components/capture-inbox";

/**
 * 首页收件箱要显示的速记。
 *
 * 只取还没处理的两种状态，到期判定交给 `pendingCaptures`——
 * 那是纯函数、有单测，界面和这里共用同一套口径。
 *
 * 不在 SQL 里比日期的原因：`snoozedUntil` 是 `@db.Date`（UTC 纯日期），
 * 和「今天」的比较必须走 `lib/date.ts` 的口径，混用会差一天。
 * 待处理的速记撑死几十条，取回来在内存里筛不值得优化。
 */
export async function getPendingCaptures(): Promise<InboxCapture[]> {
  const rows = await prisma.captureItem.findMany({
    where: { status: { in: ["INBOX", "SNOOZED"] } },
    select: {
      id: true,
      kind: true,
      title: true,
      content: true,
      createdAt: true,
      status: true,
      snoozedUntil: true,
    },
  });

  return pendingCaptures(rows).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    // 延期回来的标一下，否则用户会疑惑「这条我明明推掉了怎么又冒出来」
    wasSnoozed: row.status === "SNOOZED",
  }));
}
