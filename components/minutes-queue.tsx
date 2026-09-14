import Link from "next/link";
import { AudioLines } from "lucide-react";
import { DecorTile } from "@/components/decor-tile";
import { Button } from "@/components/ui/button";
import type { MinutesHomeQueue } from "@/lib/minutes/home";
import { deleteRecordingAudioAction } from "@/app/(app)/meetings/minutes-actions";

export function MinutesQueue({ queue }: { queue: MinutesHomeQueue }) {
  if (queue.total === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <DecorTile icon={AudioLines} domain="meeting" />
        <h2 className="text-base font-semibold">待处理会议记录</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {queue.total}
        </span>
        <Link
          href="/meetings"
          className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          全部会议 →
        </Link>
      </div>
      {/* 整组一张卡（CLAUDE.md：一条记录不是一张卡片），同 today-queue */}
      <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
        {queue.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5"
          >
            <Link
              href={item.href}
              className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline max-sm:basis-full"
            >
              {item.meetingTitle} · {item.recordingName}
            </Link>
            {item.daySixReminder ? (
              <span className="text-xs text-[var(--h-amber-fg)]">
                明天将删除原音频
              </span>
            ) : null}
            {item.expiredReminder ? (
              <span className="text-xs text-[var(--h-amber-fg)]">
                原音频已到期，等待删除
              </span>
            ) : null}
            {item.action === "retry-delete" ? (
              <form
                action={deleteRecordingAudioAction.bind(
                  null,
                  item.id,
                  item.meetingId,
                )}
              >
                <Button type="submit" size="sm" variant="outline">
                  重试删除
                </Button>
              </form>
            ) : item.action === "deletion-pending" ? (
              <Button
                render={<Link href={item.href} />}
                nativeButton={false}
                size="sm"
                variant="outline"
              >
                查看删除状态
              </Button>
            ) : (
              <Button
                render={<Link href={item.href} />}
                nativeButton={false}
                size="sm"
                variant="outline"
              >
                {item.action === "organize" ? "整理纪要" : "查看草稿"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {queue.remaining > 0 ? (
        <Link
          href="/meetings"
          className="inline-block px-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          还有 {queue.remaining} 条 →
        </Link>
      ) : null}
    </section>
  );
}
