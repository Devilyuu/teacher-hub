"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/**
 * 顶栏的深浅切换。只在浅色和深色之间来回——
 * 单人使用的工具，再摆一档「跟随系统」只是多一次点击才切得过去；
 * 首次进来的默认值仍然是跟随系统（见 theme-provider）。
 *
 * **图标用 CSS 决定显示哪个，不用 mounted 状态判断。**
 * 服务端渲染时拿不到当前主题（它在 localStorage 里），
 * 靠 `useEffect(() => setMounted(true))` 兜的话既触发 eslint 的
 * set-state-in-effect，也真的多跑一轮渲染。两个图标都渲染出来、
 * 由 `.dark` 变体挑一个显示，水合前后 HTML 完全一致，问题自己就没了。
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground"
      title="切换深浅色"
      aria-label="切换主题"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </Button>
  );
}
