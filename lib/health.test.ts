import { describe, expect, it } from "vitest";
import { getHealthStatus } from "./health";

describe("getHealthStatus", () => {
  it("数据库探测成功时返回 ok", async () => {
    await expect(getHealthStatus(async () => undefined)).resolves.toEqual({ ok: true });
  });

  it("数据库探测失败时只返回不可用，不泄露异常内容", async () => {
    await expect(
      getHealthStatus(async () => {
        throw new Error("postgresql://secret@db/internal");
      }),
    ).resolves.toEqual({ ok: false });
  });
});
