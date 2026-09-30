import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutFor } from "./shortcuts";

const key = (key: string, overrides: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  });

describe("shortcutFor", () => {
  it("Ctrl+K 和 ⌘K 都开速记，大小写都认", () => {
    expect(key("k", { ctrlKey: true })).toBe("capture");
    expect(key("K", { metaKey: true })).toBe("capture");
  });

  /** 正在填别的表单时突然想起一件事，正是速记的用处 */
  it("在输入框里按 Ctrl+K 也开速记", () => {
    expect(key("k", { ctrlKey: true, target: { tagName: "INPUT" } as unknown as EventTarget })).toBe("capture");
  });

  it("单按 K、或带了 Alt/Shift 的组合不算", () => {
    expect(key("k")).toBeNull();
    expect(key("k", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(key("k", { ctrlKey: true, altKey: true })).toBeNull();
  });

  it("斜杠去搜索", () => {
    expect(key("/")).toBe("search");
  });

  /** 否则在任何输入框里都打不出斜杠 */
  it("在输入框、文本域、可编辑区域里按斜杠不算", () => {
    for (const target of [{ tagName: "INPUT" }, { tagName: "textarea" }, { tagName: "SELECT" }, { isContentEditable: true }]) {
      expect(key("/", { target: target as unknown as EventTarget })).toBeNull();
    }
  });

  /** 拼音里打个 k、或输入法候选时的按键，不该弹出速记 */
  it("输入法组词中的按键一律不算", () => {
    expect(key("k", { ctrlKey: true, isComposing: true })).toBeNull();
    expect(key("/", { isComposing: true })).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("按钮、链接、页面本身不算正在打字", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: "A" } as unknown as EventTarget)).toBe(false);
  });
});
