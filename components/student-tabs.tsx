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
 *
 * 详情页（学生卡片、荣誉、勾名单）的 URL 里没有 `?class=`，但记录本身知道
 * 自己属于哪个班——它们显式传 `classId`，否则从详情页点 tab 会跳回默认班。
 */
export function StudentTabs({ classId }: { classId?: string } = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeStudentTab(pathname);
  const classParam = classId ?? searchParams.get("class");
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
