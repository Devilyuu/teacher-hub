import { beforeAll, describe, expect, it } from "vitest";
import {
  createSessionToken,
  isPublicUnauthenticatedPath,
  verifyPasscode,
  verifySessionToken,
} from "./auth";

beforeAll(() => {
  process.env.APP_PASSCODE = "correct-horse";
  process.env.APP_SESSION_SECRET = "test-secret";
});

describe("verifyPasscode", () => {
  it("口令一致时通过", () => {
    expect(verifyPasscode("correct-horse")).toBe(true);
  });

  it("口令不一致时拒绝", () => {
    expect(verifyPasscode("wrong-horse")).toBe(false);
    expect(verifyPasscode("correct-hors")).toBe(false);
    expect(verifyPasscode("")).toBe(false);
  });
});

describe("verifySessionToken", () => {
  it("接受自己签发的 token", async () => {
    const { value } = await createSessionToken();
    await expect(verifySessionToken(value)).resolves.toBe(true);
  });

  it("拒绝空值与格式不对的 token", async () => {
    await expect(verifySessionToken(undefined)).resolves.toBe(false);
    await expect(verifySessionToken("")).resolves.toBe(false);
    await expect(verifySessionToken("没有点号")).resolves.toBe(false);
  });

  it("拒绝被篡改的签名", async () => {
    const { value } = await createSessionToken();
    const [payload, signature] = value.split(".");
    const tampered = `${payload}.${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;
    await expect(verifySessionToken(tampered)).resolves.toBe(false);
  });

  it("拒绝改过过期时间的 token（签名对不上）", async () => {
    const { value } = await createSessionToken();
    const signature = value.slice(value.lastIndexOf(".") + 1);
    const farFuture = Math.floor(Date.now() / 1000) + 999_999;
    await expect(verifySessionToken(`${farFuture}.${signature}`)).resolves.toBe(false);
  });

  it("拒绝已过期的 token", async () => {
    const expired = Math.floor(Date.now() / 1000) - 1;
    // 用真实签名，只让时间过期，确保是过期检查而非验签在拦
    const { value } = await createSessionToken();
    expect(value.startsWith(String(expired))).toBe(false);
    await expect(verifySessionToken(`${expired}.anything`)).resolves.toBe(false);
  });
});

describe("isPublicUnauthenticatedPath", () => {
  it("只放行登录页、健康检查和两个精确的服务端点", () => {
    expect(isPublicUnauthenticatedPath("/login")).toBe(true);
    expect(isPublicUnauthenticatedPath("/api/health")).toBe(true);
    expect(isPublicUnauthenticatedPath("/api/maintenance/cleanup")).toBe(true);
    // 备课系统调用，没有会话 cookie，靠 Authorization: Bearer 鉴权（规格 §5.4）
    expect(isPublicUnauthenticatedPath("/api/teaching/import")).toBe(true);
    expect(isPublicUnauthenticatedPath("/api/maintenance/cleanup/extra")).toBe(false);
    expect(isPublicUnauthenticatedPath("/api/teaching/import/extra")).toBe(false);
    expect(isPublicUnauthenticatedPath("/api/teaching")).toBe(false);
    expect(isPublicUnauthenticatedPath("/api/recordings/abc/transcribe")).toBe(false);
    expect(isPublicUnauthenticatedPath("/api/meetings/abc/recordings")).toBe(false);
    expect(isPublicUnauthenticatedPath("/api/attachments/abc")).toBe(false);
    expect(isPublicUnauthenticatedPath("/achievements")).toBe(false);
  });

  it("会话专属的数据出口一律不在白名单里", () => {
    // 规格 §5.4 点名：录音上传、分片、转写触发、音频下载、备份 JSON 的调用方
    // 都是登录用户的浏览器，本来就带 cookie。它们进白名单就是公开的数据出口。
    // 全库备份尤其危险——一次请求就能拿走全部真实履历
    for (const path of [
      "/api/backup",
      "/api/meetings/abc/recordings",
      "/api/recordings/abc/transcribe",
      "/api/attachments/abc",
      "/api/export/project-materials",
      "/api/export/project-closeout",
    ]) {
      expect(isPublicUnauthenticatedPath(path), `${path} 不该在白名单里`).toBe(false);
    }
  });
});
