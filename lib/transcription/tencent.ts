import "server-only";

import { createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { z } from "zod";
import type { TranscriptionAdapter, TranscriptionResult } from "./types";

const HOST = "asr.cloud.tencent.com";

const responseSchema = z.object({
  code: z.number().int(),
  message: z.string().optional().default(""),
  request_id: z.string().min(1).optional(),
  audio_duration: z.number().nonnegative().optional(),
  flash_result: z.array(z.object({
    channel_id: z.number().int(),
    text: z.string(),
    sentence_list: z.array(z.object({
      text: z.string(),
      start_time: z.number().int().nonnegative(),
      end_time: z.number().int().nonnegative(),
      speaker_id: z.number().int().optional(),
    })).optional().default([]),
  })).optional().default([]),
});

export class TencentTranscriptionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TencentTranscriptionError";
  }
}

export function parseTencentFlashResponse(body: string): TranscriptionResult {
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(body));
  } catch {
    throw new TencentTranscriptionError("TENCENT_INVALID_RESPONSE", "腾讯云返回了无法解析的响应");
  }
  if (parsed.code !== 0) {
    throw new TencentTranscriptionError(`TENCENT_${parsed.code}`, `腾讯云转写失败（${parsed.code}）`);
  }
  if (!parsed.request_id || parsed.audio_duration == null) {
    throw new TencentTranscriptionError("TENCENT_INVALID_RESPONSE", "腾讯云返回了不完整的响应");
  }
  return {
    providerTaskId: parsed.request_id,
    durationSec: Math.ceil(parsed.audio_duration / 1000),
    transcript: parsed.flash_result.map((result) => result.text).join("\n"),
    segments: parsed.flash_result.flatMap((result) => result.sentence_list.map((sentence) => ({
      text: sentence.text,
      startMs: sentence.start_time,
      endMs: sentence.end_time,
      speakerId: sentence.speaker_id ?? null,
    }))),
  };
}

type FetchLike = (input: string | URL, init?: RequestInit & { duplex?: "half" }) => Promise<Response>;

type TencentOptions = {
  appId: string;
  secretId: string;
  secretKey: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  openStream?: (path: string) => Readable;
};

export function createTencentFlashAdapter(options: TencentOptions): TranscriptionAdapter {
  const appId = options.appId.trim();
  const secretId = options.secretId.trim();
  const secretKey = options.secretKey.trim();
  if (!appId || !secretId || !secretKey) throw new Error("腾讯云转写尚未配置");
  if (!/^\d+$/.test(appId)) throw new Error("腾讯云 AppID 配置无效");

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const openStream = options.openStream ?? createReadStream;

  return {
    provider: "tencent-flash",
    async transcribe(input) {
      const path = `/asr/flash/v1/${appId}`;
      const params = new URLSearchParams({
        convert_num_mode: "1",
        engine_type: "16k_zh",
        filter_dirty: "0",
        filter_modal: "0",
        filter_punc: "0",
        first_channel_only: "1",
        secretid: secretId,
        speaker_diarization: "1",
        timestamp: String(Math.floor(now().getTime() / 1000)),
        voice_format: input.voiceFormat,
        word_info: "1",
      });
      params.sort();
      const query = params.toString();
      const authorization = createHmac("sha1", secretKey)
        .update(`POST${HOST}${path}?${query}`)
        .digest("base64");
      let response: Response;
      try {
        response = await fetchImpl(`https://${HOST}${path}?${query}`, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/octet-stream",
            "Content-Length": String(input.bytes),
          },
          body: openStream(input.path) as unknown as BodyInit,
          duplex: "half",
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new TencentTranscriptionError("TENCENT_NETWORK", "腾讯云转写网络请求失败");
      }
      if (!response.ok) {
        throw new TencentTranscriptionError(`TENCENT_HTTP_${response.status}`, `腾讯云转写请求失败（HTTP ${response.status}）`);
      }
      return parseTencentFlashResponse(await response.text());
    },
  };
}

export function tencentAdapterFromEnv(env: Record<string, string | undefined> = process.env): TranscriptionAdapter {
  return createTencentFlashAdapter({
    appId: env.TENCENT_ASR_APP_ID ?? "",
    secretId: env.TENCENT_SECRET_ID ?? "",
    secretKey: env.TENCENT_SECRET_KEY ?? "",
  });
}
