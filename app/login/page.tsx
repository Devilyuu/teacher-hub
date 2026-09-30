import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { isDesktopEdition } from "@/lib/edition";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "登录",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="surface w-full max-w-sm space-y-6 p-8">
        <div className="space-y-2">
          <BrandMark className="size-11 text-primary" />
          <h1 className="font-serif text-3xl leading-tight font-black tracking-[-0.02em]">
            教师个人中台
          </h1>
          <p className="text-sm text-muted-foreground">
            沉淀在平时，取用在当下
          </p>
        </div>
        <LoginForm from={from} />
        {/* 桌面版的口令是本机配置里的，服务器上那套「问管理员」不适用。手机上多半是扫码进来的，
            忘了口令也只能回电脑上看 */}
        {isDesktopEdition() ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            忘了口令：在电脑上的教师个人中台里打开菜单「文件 → 手机访问」就能看到。
          </p>
        ) : null}
      </div>
    </main>
  );
}
