"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * 主题上下文。next-themes 往 `<html>` 上加 `.dark`，
 * 对应 globals.css 里的 `@custom-variant dark (&:is(.dark *))`。
 *
 * `defaultTheme="system"` 而不是写死浅色：首次进来跟随操作系统，
 * 手动点过切换之后才落到 localStorage 里固定下来。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // 切换瞬间禁掉过渡：否则全站几十个 transition-colors 会一起跑，
      // 表格那种上百行的页面能卡出一帧糊影
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
