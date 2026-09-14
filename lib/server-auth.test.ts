import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken } from "./auth";
import { requireSession } from "./server-auth";

beforeAll(() => {
  process.env.APP_SESSION_SECRET = "server-auth-test-secret";
});

describe("requireSession", () => {
  it("接受有效的签名会话", async () => {
    const { value } = await createSessionToken();
    await expect(requireSession(async () => value)).resolves.toBeUndefined();
  });

  it("拒绝缺失或伪造的会话", async () => {
    await expect(requireSession(async () => undefined)).rejects.toThrow("未登录");
    await expect(requireSession(async () => "forged.token")).rejects.toThrow("未登录");
  });
});
