"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ModuleVisibility } from "@/lib/modules";
import { activeNavHref, mobileTabsFor, navItemsFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";

/**
 * 手机底部导航（< 768px，2026-09-13）。
 *
 * 原来手机上是 66px 的图标栏：占掉 17% 屏宽，还把全部文字藏了，
 * 七个认不全的图标竖着一排。底部导航是手机上的通行做法，拇指够得着、带文字。
 *
 * 只放高频的四五项（名单在 lib/nav.ts 的 `mobileTabsFor`），其余进顶栏菜单。
 * 每格 56px 高，远超 44px 的触控下限。底部留出 `safe-area-inset-bottom`，
 * 否则全面屏手机的横条会压住文字。
 */
export function MobileTabBar({ modules }: { modules: ModuleVisibility }) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const tabs = mobileTabsFor(modules);

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = activeHref === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                  active ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 手机顶栏左侧的菜单抽屉。放**全集**：底栏放不下的教学、班主任，
 * 以及桌面上在侧栏底部的设置、退出。
 *
 * 做成从底部升起的面板而不是左侧抽屉——底栏就在下面，菜单从同一个方向出来，
 * 手指不用跨到屏幕另一头去找。
 */
export function MobileMenu({ modules }: { modules: ModuleVisibility }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);

  const itemClass =
    "flex h-12 items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-muted";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开菜单"
            className="shrink-0 text-muted-foreground md:hidden"
          />
        }
      >
        <Menu className="size-5" aria-hidden />
      </DialogTrigger>

      <DialogContent className="top-auto bottom-0 left-0 max-h-[85svh] w-full max-w-none translate-x-0 translate-y-0 gap-1 overflow-y-auto rounded-t-2xl rounded-b-none p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:max-w-none">
        <div className="flex items-center gap-2 px-3 pt-1 pb-3">
          <BrandMark className="size-7 text-primary" />
          <DialogTitle className="font-serif text-base font-black tracking-[-0.02em]">
            教师个人中台
          </DialogTitle>
        </div>

        <nav aria-label="全部导航" className="flex flex-col">
          {navItemsFor(modules).map(({ href, label, icon: Icon }) => {
            const active = activeHref === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(itemClass, active && "bg-accent font-medium text-accent-foreground")}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-1 flex flex-col border-t pt-1">
          <Link href="/settings" onClick={() => setOpen(false)} className={cn(itemClass, "text-muted-foreground")}>
            <Settings className="size-5 shrink-0" aria-hidden />
            设置
          </Link>
          <form action={logout}>
            <button type="submit" className={cn(itemClass, "w-full cursor-pointer text-muted-foreground")}>
              <LogOut className="size-5 shrink-0" aria-hidden />
              退出
            </button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
