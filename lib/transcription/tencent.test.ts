import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createTencentFlashAdapter, parseTencentFlashResponse } from "./tencent";

describe("Tencent flash transcription adapter", () => {
  it("signs sorted query parameters and streams the binary body", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(Readable);
      return new Response(JSON.stringify({
        code: 0,
        message: "",
        request_id: "request-123",
        audio_duration: 61_001,
        flash_result: [{
          channel_id: 0,
          text: "正文不得进入日志",
          sentence_list: [{ text: "第一句", start_time: 0, end_time: 1000, speaker_id: 0 }],
        }],
      }), { status: 200 });
    });
    const adapter = createTencentFlashAdapter({
      appId: "1250000000",
      secretId: "AKIDEXAMPLE",
      secretKey: "secret-key",
      fetchImpl,
      now: () => new Date("2026-08-03T04:00:00.000Z"),
      openStream: () => Readable.from([Buffer.from("audio")]),
    });

    const result = await adapter.transcribe({ path: "ignored.wav", bytes: 5, voiceFormat: "wav" });
    const [url, init] = fetchImpl.mock.calls[0];
    const parsedUrl = new URL(String(url));
    expect([...parsedUrl.searchParams.keys()]).toEqual([...parsedUrl.searchParams.keys()].sort());
    const signingText = `POST${parsedUrl.host}${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`;
    const expected = createHmac("sha1", "secret-key").update(signingText).digest("base64");
    expect(new Headers(init?.headers).get("Authorization")).toBe(expected);
    expect(new Headers(init?.headers).get("Content-Length")).toBe("5");
    expect(result).toMatchObject({
      providerTaskId: "request-123",
      durationSec: 62,
      transcript: "正文不得进入日志",
      segments: [{ text: "第一句", startMs: 0, endMs: 1000, speakerId: 0 }],
    });
  });

  it("fails with a sanitized provider code and never includes response text", async () => {
    const response = JSON.stringify({ code: 4006, message: "secret/audio transcript/path" });
    expect(() => parseTencentFlashResponse(response)).toThrowError(expect.objectContaining({
      code: "TENCENT_4006",
      message: "腾讯云转写失败（4006）",
    }));
  });

  it("fails clearly when credentials are absent", () => {
    expect(() => createTencentFlashAdapter({ appId: "", secretId: "", secretKey: "" }))
      .toThrow(/尚未配置/);
  });
});
