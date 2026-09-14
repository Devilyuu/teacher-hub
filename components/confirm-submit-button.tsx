"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Submit({
  message,
  children,
  className,
  size,
  label,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
  size: "sm" | "icon-sm";
  label?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size={size}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground", className)}
      onClick={(event) => {
        if (!confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

/**
 * 点了先问一句再提交的删除按钮，给**硬删除**用。
 *
 * 能撤销的删除（任务、速记）不走这里——那两个走「移入回收站 / 不要了 + 撤销 Toast」，
 * 每次都弹确认只会训练人闭眼点「确定」。确认框留给真的找不回来的东西，
 * 所以 `message` 里**必须写清对象和后果**：「删除「XX」连同 12 条记录」，
 * 不是一句「确定吗」。
 *
 * 做成客户端组件是因为 `confirm()` 只能在浏览器里跑，而调用它的页面多半是
 * 服务端组件——绑定好参数的 Server Action 可以直接当 prop 传进来。
 */
export function ConfirmSubmitButton({
  action,
  message,
  children,
  className,
  size = "sm",
  label,
}: {
  action: () => void | Promise<void>;
  message: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "icon-sm";
  /** 图标按钮必须给，读屏和悬停提示都靠它 */
  label?: string;
}) {
  return (
    <form action={action}>
      <Submit message={message} className={className} size={size} label={label}>
        {children}
      </Submit>
    </form>
  );
}
