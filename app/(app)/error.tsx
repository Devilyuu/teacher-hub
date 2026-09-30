"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * 登录后区域的错误边界。Server Action 里 `throw` 出来的业务错误
 * （例如「会议仍有私有录音，先删录音」）和真正的服务端异常都落到这里，
 * 页面框架（侧栏、顶栏）保持在原位，不再变成 Next 默认的全屏英文错误页。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // 生产环境下 Next 会把服务端异常的 message 抹成通用文案并只留 digest；
  // 开发环境和 Server Action 主动 throw 的中文提示照原样显示
  const detail = error.message && !error.digest ? error.message : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-[14px] bg-well px-6 py-12 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">这一步没有完成</h1>
        <p className="measure text-sm text-muted-foreground">
          {detail ?? "服务端出了点问题。刷新一次通常就好；反复出现的话记下时间去看日志。"}
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground tabular-nums">错误编号 {error.digest}</p>
        ) : null}
      </div>
      <Button size="sm" onClick={reset}>
        重试
      </Button>
    </div>
  );
}
