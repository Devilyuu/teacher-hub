/**
 * 全局键盘快捷键。纯函数，事件监听在 `components/quick-capture.tsx` 与
 * `components/search-shortcut.tsx`。
 *
 * 速记是这个平台最高频的动作、搜索第二（CLAUDE.md），两个都只能靠鼠标点顶栏
 * （2026-09-14 审计、09-25 评审都点过）。只给这两个配键，**不做一整套快捷键**：
 * 记不住的快捷键等于没有。
 *
 * - `Ctrl/⌘ + K`：开速记。在输入框里也认——正在别处填表单时突然想起一件事，正是速记的用处
 * - `/`：去搜索。**在输入框里不认**，否则打不出斜杠
 */

export type Shortcut = "capture" | "search";

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
};

/** 正在往里打字的元素：输入框、文本域、下拉、可编辑区域 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function shortcutFor(event: KeyLike): Shortcut | null {
  // 中文输入法组词时的按键不算：拼音里打个 k 不该弹出速记
  if (event.isComposing) return null;
  if (
    event.key.toLowerCase() === "k" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "capture";
  }
  if (
    event.key === "/" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isTypingTarget(event.target)
  ) {
    return "search";
  }
  return null;
}
