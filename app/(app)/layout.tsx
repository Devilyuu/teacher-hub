import Link from "next/link";
import { Search } from "lucide-react";
import { MobileMenu, MobileTabBar } from "@/components/mobile-nav";
import { QuickCapture } from "@/components/quick-capture";
import { SideNav } from "@/components/side-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { getEnabledModules } from "@/lib/module-settings";

/**
 * 登录后的这一整组页面一律动态渲染，覆盖组内所有子路由。
 *
 * 不加这行的话，凡是没读 `searchParams` 的页面（`/achievements/new`、
 * `/projects/new` 等）会被 `next build` 判定为静态页，**在构建期就把库查了、
 * 把结果烘进 HTML**：新加的绩效小类不重新构建就永远不出现在下拉框里。
 * dev 下每次请求都渲染，所以这个坑只在 `next start` 后才现形。
 *
 * 鉴权在 `proxy.ts` 里做，而 proxy 不会让页面变成动态的——别指望它兜底。
 */
export const dynamic = "force-dynamic";

/**
 * 在水合前把侧栏收起态写进 `<html>`。
 *
 * 侧栏宽度由 CSS 的 `:root[data-sidebar="collapsed"]` 决定（globals.css），
 * 而服务端渲染时读不到 localStorage——不提前注入的话，收起过侧栏的人
 * **每打开一页都会看见它从 214px 弹到 66px**。和 next-themes 防止
 * 深色闪白是同一个套路。
 */
const SIDEBAR_INIT = `try{if(localStorage.getItem("sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 模块开关决定导航长什么样。本组页面 force-dynamic，每请求读一次，
  // 设置页一保存导航立即变化，不存在缓存失效问题
  const modules = await getEnabledModules();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT }} />
      <div className="flex min-h-svh">
        {/* 2026-09-12 改版：导航从顶部胶囊换成左侧竖排。
            理由见 components/side-nav.tsx 顶部——是使用者变了，不是更好看 */}
        <SideNav modules={modules} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 顶栏只剩「随时要用的动作」：搜索和速记。
              设置、退出都挪进侧栏底部了——它们是偶尔来一次的事，
              不该天天占着视线最好的右上角 */}
          {/* 高度写在 header 自己身上（border-box，含下边框），这样
              --topbar-h 就是它占的全部高度，表头吸顶直接用同一个值 */}
          <header className="sticky top-0 z-20 h-[var(--topbar-h)] border-b bg-background/85 backdrop-blur-md">
            <div className="flex h-full items-center gap-2 px-4 md:px-6">
              {/* 只在手机上出现：侧栏在 < 768px 整个隐藏，底栏放不下的入口都在这里 */}
              <MobileMenu modules={modules} />
              {/* 搜索做成一条真正的输入框样子而不是一个放大镜图标：
                  全局搜索是这平台第二常用的动作（仅次于速记），
                  藏成图标等于让人先想起"这里有搜索"才用得上 */}
              <Link
                href="/search"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-well px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:max-w-md"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="truncate">搜索课题、成果、任务、学生…</span>
              </Link>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {/* 快速记录常驻顶栏（规格 §4.2）：随时能记，不占一级导航位 */}
                <QuickCapture />
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* 内容区满宽，不再是 max-w-[84rem] 居中——侧栏已经吃掉左边
              214px，再居中会把表格挤成一条。上限 110rem 是防超宽屏拉伸：
              1920 屏上根本触不到，2560 屏才开始居中 */}
          {/* 手机上底部多留一截给底栏（56px + 安全区），否则最后几行被它压住 */}
          <main className="mx-auto w-full max-w-[110rem] flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 md:pb-16">
            {children}
          </main>
        </div>
      </div>
      <MobileTabBar modules={modules} />
    </>
  );
}
