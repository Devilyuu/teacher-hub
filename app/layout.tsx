import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
// 展示层衬线（页面标题、首页大数字）。选 @fontsource 而不是 next/font/google：
// 后者在构建期连 Google 拉字体，腾讯云上的构建连不上就红；这份是随包自托管的。
// CSS 按 unicode-range 切了 100 多片，浏览器只拉标题实际用到的那几片（几十 KB），
// 没有违反「不为几千个汉字拉一份 Web Font」——那条禁的是全量字形。
import "@fontsource/noto-serif-sc/900.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    // 界面品牌名「教师个人中台」（2026-08-31 用户定名）：中台 = 把成果沉淀在一处、
    // 供结题/绩效/职称各场景取用，比「工作台」更贴平台机理。
    // 代码与文档仍叫 teacher-desk，不跟着改
    default: "教师个人中台",
    template: "%s · 教师个人中台",
  },
  description: "平时把散落的东西沉淀进来，用时按场景取一份出去。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes 在水合前就把 `.dark` 写到 html 上，
    // 服务端渲染的 class 必然对不上，这里的告警必须抑制
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          {/* 撤销类提示的唯一出口（「已移入回收站 · 撤销」）。挂在根布局而不是
              (app) 布局：删除后那一行会随 revalidate 消失，提示得活得比它久。
              手机上抬高到底部导航之上，否则正好压住导航栏 */}
          <Toaster
            position="bottom-center"
            mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
