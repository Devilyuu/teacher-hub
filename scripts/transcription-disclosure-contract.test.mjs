import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const source = (pathname) => readFileSync(resolve(root, pathname), "utf8");

describe("transcription disclosure and UI contract", () => {
  it("states cloud/local lifecycle and keeps unconfigured ASR separate from upload success", () => {
    const panel = source("app/(app)/meetings/[id]/recording-panel.tsx");
    expect(panel).toMatch(/音频会发送到腾讯云/);
    expect(panel).toMatch(/不保留云端副本/);
    expect(panel).toMatch(/纪要确认后会立即删除本机原音频/);
    expect(panel).toMatch(/第 6 天提醒、第 7 天自动删除/);
    expect(panel).toMatch(/asrConfigured/);
    expect(panel).toMatch(/router\.refresh\(\)/);
    expect(source("app/(app)/meetings/[id]/meeting-detail.tsx")).toMatch(/asrConfigured/);
    expect(source("app/(app)/meetings/[id]/page.tsx")).toMatch(/integrationStatuses/);
    const settings = source("app/(app)/settings/page.tsx");
    expect(settings).toMatch(/不保留云端副本/);
    expect(settings).toMatch(/纪要确认后立即删除本机原音频/);
    expect(settings).toMatch(/转写失败不自动删除/);
  });
});
