"use client";

import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backupFileName } from "@/lib/backup/serialize";
import { isBackupPayload, isSessionRedirect } from "@/lib/backup/response";

/**
 * 全库 JSON 备份的下载表单（增量 3.8）。
 *
 * **走 fetch 而不是原生 form 提交**：原生提交在口令错时会把浏览器导航到一个
 * 显示 `{"error":"口令不正确"}` 的白页，用户得按返回键回来重填——
 * 而这个表单最常见的交互恰恰就是打错一次口令。
 *
 * 代价是响应要先进 blob 再落盘，也就是整份文件会在浏览器内存里过一遍。
 * 服务端那边是真流式（见 `lib/backup/export.ts`），这里不是——
 * 取舍的理由是：服务端要扛的是"多条上百 KB 的转写稿累加"，
 * 而浏览器这边下载一个几 MB 的 JSON 完全无压力。
 */
export function BackupForm() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const form = new FormData();
      form.set("passcode", passcode);

      // `redirect: "manual"`：proxy.ts 对未登录请求一律重定向到 /login，
      // 连 /api/* 也不例外。默认的 follow 会让 fetch 跟过去、拿回登录页 HTML
      // 且 response.ok === true——那样下载下来的是一个后缀 .json 的登录页
      const response = await fetch("/api/backup", {
        method: "POST",
        body: form,
        redirect: "manual",
      });

      if (isSessionRedirect(response)) {
        setError("登录已过期，请刷新页面重新登录后再试");
        return;
      }

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : "备份失败，请重试";
        setError(message);
        return;
      }

      // 走到这里仍然可能不是备份文件（比如将来 proxy 换成别的挡法）。
      // 宁可报错也不能把非 JSON 存成 .json
      if (!isBackupPayload(response.headers.get("Content-Type"))) {
        setError("服务端没有返回备份文件，请刷新页面重新登录后再试");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // 服务端也设了 Content-Disposition，但 blob 下载不走它，这里得自己给名字。
      // 两边同一天生成的名字一致（同一个纯函数）
      link.download = backupFileName(new Date());
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      // 成功后清空口令：这个框里留着口令，下次谁打开设置页都能看见 autofill
      setPasscode("");
    } catch {
      setError("备份失败，请检查网络后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="backup-passcode" className="text-xs">
            登录口令
          </Label>
          <Input
            id="backup-passcode"
            name="passcode"
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            className="h-9 w-52"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || passcode === ""}>
          <Download className="size-3.5" aria-hidden />
          {pending ? "生成中…" : "下载备份"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
