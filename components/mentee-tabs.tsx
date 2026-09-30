"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MENTEE_TABS, activeMenteeTab } from "@/lib/nav";

/**
 * 「导师」下面的二级导航：我的学生 / 指导记录。
 * 与 RoutineTabs、StudentTabs、AchievementTabs 同一形状（下划线 tab，不是胶囊）。
 *
 * ?batch= 跨 tab 保留——两个视图共享同一个「当前批次」，
 * 切个 tab 就跳回最近一届，带两届学生的人会抓狂。
 *
 * 详情页的 URL 里没有 `?batch=`，但记录本身知道自己属于哪一批——
 * 它们显式传 `batchId`，否则从详情页点 tab 会跳回默认批次。
 */
export function MenteeTabs({ batchId }: { batchId?: string } = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeMenteeTab(pathname);
  const batchParam = batchId ?? searchParams.get("batch");
  const suffix = batchParam ? `?batch=${encodeURIComponent(batchParam)}` : "";

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MENTEE_TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={`${href}${suffix}`}
          aria-current={active === href ? "page" : undefined}
          className="subtab"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
