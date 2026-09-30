"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { shortcutFor } from "@/lib/shortcuts";

/**
 * 按 `/` 去搜索页（口径在 lib/shortcuts.ts：在输入框里不认，否则打不出斜杠）。
 * 搜索页的输入框本来就 autoFocus，跳过去直接能打字。
 *
 * 只挂监听不画东西；顶栏搜索框右端那个「/」提示在 (app)/layout.tsx 里
 */
export function SearchShortcut() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shortcutFor(event) !== "search") return;
      event.preventDefault();
      router.push("/search");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}
