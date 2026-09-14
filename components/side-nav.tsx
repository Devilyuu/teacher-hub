"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, LogOut, Settings } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import type { ModuleVisibility } from "@/lib/modules";
import { activeNavHref, navItemsFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { logout } from "@/app/login/actions";

/**
 * 左侧竖排导航（2026-09-12 改版，取代原来的顶部胶囊导航）。
 *
 * 换位置的理由不是"侧边栏更好看"，是使用者变了：平台要给别的老师用，
 * 而老师判断"这是不是个正经系统"的参照物是教务系统、学习通、政务 OA——
 * 左侧竖排带图标的导航是他们的锚点。
 *
 * **收起状态走 CSS，不走 React state。** `<html data-sidebar="collapsed">`
 * 由 (app)/layout.tsx 里的内联脚本在水合前就写好，宽度和文字显隐全由
 * globals.css 的属性选择器决定。这里的按钮只负责翻转那个属性 + 落盘。
 * 用 useState 的话，服务端渲染不知道 localStorage，收起过的人每次进页面
 * 都会看见侧栏从 214px 弹到 66px——而这是每一页都会发生的闪。
 *
 * **只做一级导航。** 二级（日常那四个、成果那三个、班主任那四个）继续
 * 留在内容区的 tabs 组件里。两处都画一遍就是同一件事有两个入口，
 * 而侧栏一展开二级，收起态又没地方放它们。
 */
export function SideNav({ modules }: { modules: ModuleVisibility }) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);

  function toggle() {
    const root = document.documentElement;
    const collapsed = root.dataset.sidebar === "collapsed";
    if (collapsed) delete root.dataset.sidebar;
    else root.dataset.sidebar = "collapsed";
    // localStorage 在隐私模式下会抛，收起本身仍然生效，不值得为它中断
    try {
      localStorage.setItem("sidebar", collapsed ? "expanded" : "collapsed");
    } catch {}
  }

  return (
    <aside
      aria-label="主导航"
      // max-md:hidden：手机上改用底部导航 + 顶栏菜单（components/mobile-nav.tsx）。
      // 768–1023px 仍是 66px 图标栏（globals.css 的窄屏规则），≥1024px 才可展开
      className="sticky top-0 z-30 flex h-svh w-[var(--sidebar-w)] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar px-3 py-3.5 transition-[width] duration-200 max-md:hidden"
    >
      <div className="side-brand flex items-center gap-2 px-1 pb-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {/* 裸标记不装圆片：它自己就是章。text-primary 亮色是青绿、暗色自动转雾面 */}
          <BrandMark className="size-7 shrink-0 text-primary" />
          {/* 字标是衬线仅剩的两处之一（另一处是登录页标题）。
              改版后 .page-title 已经不用衬线了，留这里是为了还认得出是谁 */}
          <span className="side-label truncate font-serif text-[16px] font-black tracking-[-0.02em]">
            教师个人中台
          </span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          // 一个图标两种朝向：收起时 CSS 把它转 180°。
          // 渲染两个图标再按状态切显隐的话，服务端渲染时两个都在 DOM 里，
          // 收起态会先闪一下错的那个
          className="side-toggle ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-md bg-well text-muted-foreground transition-colors hover:text-foreground"
          title="收起 / 展开侧栏"
          aria-label="收起或展开侧栏"
        >
          <ChevronsLeft className="size-3.5 transition-transform" aria-hidden />
        </button>
      </div>

      {navItemsFor(modules).map(({ href, label, icon: Icon }) => {
        const active = activeHref === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "side-item relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {active ? (
              // 激活指示条。left 比侧栏内边距(12px)小 4px——贴死在边缘会
              // 紧挨着窗口边框，读起来像溢出去了
              <span
                aria-hidden
                className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-sm bg-primary"
              />
            ) : null}
            <Icon className="size-[18px] shrink-0" aria-hidden />
            <span className="side-label truncate">{label}</span>
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col gap-0.5 border-t pt-2.5">
        {/* 设置和退出不占一级导航位——偶尔来一次的事 */}
        <Link
          href="/settings"
          title="设置"
          className="side-item flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-[18px] shrink-0" aria-hidden />
          <span className="side-label truncate">设置</span>
        </Link>
        <form action={logout}>
          <button
            type="submit"
            title="退出"
            className="side-item flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-[18px] shrink-0" aria-hidden />
            <span className="side-label truncate">退出</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
