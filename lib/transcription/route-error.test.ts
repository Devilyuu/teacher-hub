import { describe, expect, it } from "vitest";
import { safeTranscriptionError } from "./route-error";

describe("safeTranscriptionError", () => {
  it("keeps an approved user-facing validation message", () => {
    expect(safeTranscriptionError(new Error("腾讯云转写尚未配置，请先在设置页完成配置"))).toBe(
      "腾讯云转写尚未配置，请先在设置页完成配置",
    );
  });

  it.each([
    "音频内容格式与扩展名不一致",
    "无法读取音频元数据，请确认文件未损坏且格式正确",
  ])("keeps the actionable audio validation message: %s", (message) => {
    expect(safeTranscriptionError(new Error(message))).toBe(message);
  });

  it("no longer exposes the obsolete duration-only metadata message", () => {
    expect(safeTranscriptionError(new Error("无法读取音频时长，请确认文件未损坏且格式正确"))).toBe(
      "操作失败，请稍后重试",
    );
  });

  it("does not expose paths, SQL, credentials, or provider bodies", () => {
    expect(safeTranscriptionError(new Error("ENOENT C:\\secret\\audio.m4a secretKey=abc"))).toBe(
      "操作失败，请稍后重试",
    );
  });
});
