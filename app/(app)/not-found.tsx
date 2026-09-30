import Link from "next/link";
import { MagnifierArt } from "@/components/empty-art";
import { buttonVariants } from "@/components/ui/button";

/**
 * 登录后区域的 404：失效的 id、刚删掉的记录、打错的地址都落到这里。
 * 没有这个文件时看到的是 Next 默认的英文页，没有导航、没有中文。
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-[14px] bg-well px-6 py-12 text-center">
      <MagnifierArt className="size-16 text-muted-foreground/60" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">找不到这条记录</h1>
        <p className="measure text-sm text-muted-foreground">
          它可能刚被删除，或者链接里的地址不对。
        </p>
      </div>
      <Link href="/" className={buttonVariants({ size: "sm" })}>
        回首页
      </Link>
    </div>
  );
}
