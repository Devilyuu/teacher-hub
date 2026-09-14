import "dotenv/config";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { tencentAdapterFromEnv } from "../lib/transcription/tencent";
import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_SEC } from "../lib/transcription/policy";
import type { AudioVoiceFormat } from "../lib/transcription/types";

/**
 * 腾讯云转写真实 smoke（增量 3.3 的配置验证）。
 *
 * **不碰数据库、不写任何东西**，只拿 `.env` 里的三项凭证真调一次 ASR。
 *
 *   npm run smoke:transcription -- path/to/audio.m4a
 *
 * 用一段**真实的会议录音片段**（十几秒就够）。腾讯云按时长计费，
 * 这一次调用的成本可以忽略，但它能一次性回答三个问题：
 * 凭证对不对、格式收不收、中文识别得怎么样。
 */

const FORMATS = new Set(["m4a", "mp3", "wav", "aac"]);

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error(
      [
        "用法：npm run smoke:transcription -- <音频文件路径>",
        "",
        "支持 m4a / mp3 / wav / aac，不超过 100MB、不超过 2 小时。",
        "拿一段十几秒的真实会议录音最有价值——顺带能看出中文识别质量。",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const path = resolve(process.cwd(), input);
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!extension || !FORMATS.has(extension)) {
    console.error(`只支持 m4a / mp3 / wav / aac，拿到的是 .${extension ?? "（无扩展名）"}`);
    process.exitCode = 1;
    return;
  }

  const info = await stat(path).catch(() => null);
  if (!info) {
    console.error(`找不到文件：${path}`);
    process.exitCode = 1;
    return;
  }
  if (info.size > AUDIO_MAX_BYTES) {
    console.error(`文件 ${(info.size / 1024 / 1024).toFixed(1)}MB，超过 100MB 上限`);
    process.exitCode = 1;
    return;
  }

  const adapter = tencentAdapterFromEnv();
  console.log(`provider: ${adapter.provider}`);
  console.log(`appId:    ${process.env.TENCENT_ASR_APP_ID}`);
  console.log(`文件:     ${path}（${(info.size / 1024).toFixed(0)}KB, .${extension}）`);
  console.log(`引擎:     16k_zh（中文普通话，代码里写死）`);
  console.log("");
  console.log("正在调用腾讯云 …（按音频时长计费，这一次的成本可忽略）");

  const started = Date.now();
  const result = await adapter.transcribe({
    path,
    bytes: info.size,
    // 上面的 FORMATS 已经把它收窄到这四个值之一
    voiceFormat: extension as AudioVoiceFormat,
  });
  const elapsed = Date.now() - started;

  console.log("");
  console.log(`smoke 通过（${elapsed}ms）`);
  console.log(`  请求 ID:  ${result.providerTaskId}`);
  console.log(`  音频时长: ${result.durationSec}s${result.durationSec > AUDIO_MAX_DURATION_SEC ? "（超过 2 小时上限，正式上传会被拒）" : ""}`);
  console.log(`  分段数:   ${result.segments.length}`);
  console.log("");
  console.log("转写结果：");
  console.log(result.transcript.slice(0, 500) || "（空——如果音频里确实有人说话，检查是不是采样率或声道不对）");
  console.log("");
  console.log("识别质量自己判断一下：专有名词、人名、课题名称错得多不多。");
  console.log("错得多的话纪要草稿也会跟着错——它是拿这段文字生成的。");
}

main().catch((error: unknown) => {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);

  console.error(`smoke 失败：${message}${code ? `（${code}）` : ""}`);
  console.error("");
  console.error("常见原因：");
  console.error("  腾讯云 AppID 配置无效   AppID 必须是纯数字，别把 SecretId 填进去了");
  console.error("  TENCENT_HTTP_401/403   SecretId/SecretKey 不对，或子账号没有 ASR 权限");
  console.error("  TENCENT_4xx            账号未开通语音识别，或余额/资源包用尽");
  console.error("  TENCENT_NETWORK        网络不通或超过 120 秒超时");
  console.error("  TENCENT_INVALID_RESPONSE  返回结构变了，需要看一眼原始响应");
  process.exitCode = 1;
});
