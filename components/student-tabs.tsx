"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { STUDENT_TABS, activeStudentTab } from "@/lib/nav";

/**
 * 「班主任」下面的二级导航：名册 / 勾名单 / 荣誉 / 记录。
 * 与 RoutineTabs、AchievementTabs 同一形状（轻一档、无底色）。
 *
 * ?class= 跨 tab 保留——四个视图共享同一个「当前班级」，
 * 切个 tab 就跳回默认班会让带两个班的老师抓狂。
 */
export function StudentTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeStudentTab(pathname);
  const classParam = searchParams.get("class");
  const suffix = classParam ? `?class=${encodeURIComponent(classParam)}` : "";

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {STUDENT_TABS.map(({ href, label }) => (
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
