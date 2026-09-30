import Link from "next/link";

/**
 * 根级 404：没有任何路由匹配的地址（`/foo`）落到这里。
 * (app) 组内 `notFound()` 抛出的走 app/(app)/not-found.tsx，带侧栏；
 * 这一份在根布局里渲染，没有导航，所以只给一个回首页的链接。
 */
export default function RootNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">这个地址不存在</h1>
      <p className="text-sm text-muted-foreground">检查一下链接，或者从首页重新进入。</p>
      <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        回首页
      </Link>
    </main>
  );
}
