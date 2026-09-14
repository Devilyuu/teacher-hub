"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ACHIEVEMENT_TABS, activeAchievementTab } from "@/lib/nav";

/**
 * 「成果」下面的二级导航：台账 / 待核实 / 导出。
 *
 * 与 RoutineTabs 同一形状（轻一档、无底色），但高亮多看一个查询参数——
 * 台账和待核实是同一个路径，见 `activeAchievementTab`。
 */
export function AchievementTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeAchievementTab(pathname, searchParams.get("unverified"));

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ACHIEVEMENT_TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={active === href ? "page" : undefined}
          className="subtab"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
