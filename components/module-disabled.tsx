import Link from "next/link";
import { ClipboardArt } from "@/components/empty-art";
import { moduleLabel, type ModuleKey } from "@/lib/modules";

/**
 * 直接访问被关闭模块的 URL 时显示的提示页。
 *
 * **不是 403 也不是 404**：关闭 = 隐藏，不 = 封锁。书签、历史记录里的
 * 旧链接点进来，用户该知道「东西还在，只是模块关了」，而不是以为坏了。
 * 数据一个字节没动，去设置勾上就回来。
 */
export function ModuleDisabledNotice({ moduleKey }: { moduleKey: ModuleKey }) {
  const label = moduleLabel(moduleKey);
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-14 text-center">
      <ClipboardArt className="size-12 text-muted-foreground/60" />
      <p className="text-sm font-medium">「{label}」模块未启用</p>
      <p className="measure text-sm text-muted-foreground">
        里面的数据都还在，只是这个模块被关闭了。到
        <Link href="/settings" className="px-0.5 text-foreground underline underline-offset-4">
          设置
        </Link>
        里勾上「{label}」就能继续用。
      </p>
    </div>
  );
}
