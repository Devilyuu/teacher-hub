"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ModuleVisibility } from "@/lib/modules";
import { routineTabsFor } from "@/lib/nav";

/**
 * 「日常」下面的二级导航：任务 / 会议 / 轮派 / 日历。
 * 「轮派」是可选模块，关掉就不出现——开关由服务端页面查好传进来。
 *
 * 比一级导航轻一档（无底色、只有下划线），否则两排胶囊叠在一起
 * 分不出层级。URL 全部扁平，这里只是把它们在视觉上归成一组。
 */
export function RoutineTabs({ modules }: { modules: ModuleVisibility }) {
  const pathname = usePathname();

  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {routineTabsFor(modules).map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="subtab"
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
