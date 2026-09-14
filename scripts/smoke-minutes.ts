import "dotenv/config";
import { CHUNK_SYSTEM_PROMPT, minutesAdapterFromEnv, pointsSchema } from "../lib/minutes/adapter";

/**
 * 纪要服务真实 smoke（增量 3.4 的配置验证）。
 *
 * **不碰数据库、不写任何东西**，只拿 `.env` 里的三项配置真调一次模型，
 * 把返回值按正式的 Zod schema 校验一遍。
 *
 * 为什么值得单独写：不跑它的话，"配置对不对"要等到部署后上传一段音频、
 * 转写完、点生成纪要才知道——那时错的是哪一环都分不清。
 *
 *   npm run smoke:minutes
 */

const SAMPLE_SEGMENTS = [
  { text: "今天开会主要讨论三件事，先说人才培养方案的修订。", startMs: 0, endMs: 5000, speakerId: 0 },
  { text: "第一稿下周三之前交给我，李老师负责数字媒体那一块。", startMs: 5000, endMs: 11000, speakerId: 0 },
  { text: "好的，我这边周三上午能给出来。", startMs: 11000, endMs: 14000, speakerId: 1 },
  { text: "第二件事是横向课题的到账经费，合同写的是分两期。", startMs: 14000, endMs: 20000, speakerId: 0 },
  { text: "那我们下次开会前把第一期的发票整理好。", startMs: 20000, endMs: 25000, speakerId: 1 },
];

async function main() {
  const adapter = minutesAdapterFromEnv();

  if (!adapter) {
    console.error(
      [
        "纪要服务未配置：MINUTES_API_BASE_URL / MINUTES_API_KEY / MINUTES_MODEL 三项都是空的。",
        "",
        "这不是错误——三项全空时系统会自动降级为手工纪要，转写和确认都照常。",
        "要验证配置，请先在 .env 里把三项填齐。",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`provider: ${adapter.provider}`);
  console.log(`model:    ${process.env.MINUTES_MODEL}`);
  console.log(`endpoint: ${process.env.MINUTES_API_BASE_URL}（代码会自动拼 /chat/completions）`);
  console.log("");

  console.log("① 分段摘要 summarizeChunk …");
  const started = Date.now();
  const points = await adapter.summarizeChunk({
    startMs: 0,
    endMs: 25000,
    text: SAMPLE_SEGMENTS.map((segment) => segment.text).join("\n"),
  });
  console.log(`   通过（${Date.now() - started}ms）`);
  console.log(`   要点 ${points.summaryPoints.length} 条、待办线索 ${points.tasks.length} 条`);

  console.log("② 合并成草稿 mergePoints …");
  const mergeStarted = Date.now();
  const draft = await adapter.mergePoints([points]);
  console.log(`   通过（${Date.now() - mergeStarted}ms）`);
  console.log("");

  console.log("生成的草稿（截断显示）：");
  console.log(`  摘要：${(draft.summary ?? "").slice(0, 120)}`);
  console.log(`  讨论：${(draft.discussion ?? "").slice(0, 120)}`);
  console.log(`  决议 ${draft.resolutions?.length ?? 0} 条、待办 ${draft.tasks?.length ?? 0} 条、未决 ${draft.openIssues?.length ?? 0} 条`);
  console.log("");
  console.log("smoke 通过：凭证有效，返回结构符合 Zod 契约，可以部署。");
}

/**
 * 结构校验失败时，直接对同一个端点再发一次同样的请求，把模型的原始输出打出来。
 *
 * 适配器为了不泄漏上游细节，把解析错误统一收敛成 `MINUTES_INVALID_RESPONSE`——
 * 线上该这么做，但配置阶段看不见原文就没法判断是"模型不支持 JSON 模式"
 * 还是"结构对不上"。这两件事的处理方式完全不同。
 */
async function diagnose(): Promise<void> {
  const base = process.env.MINUTES_API_BASE_URL?.trim();
  const key = process.env.MINUTES_API_KEY?.trim();
  const model = process.env.MINUTES_MODEL?.trim();
  if (!base || !key || !model) return;

  const endpoint = `${base.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        // 用适配器真正在发的那份提示词，否则诊断出来的结论对不上线上行为
        { role: "system", content: CHUNK_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            text: SAMPLE_SEGMENTS.map((segment) => segment.text).join("\n"),
            startMs: 0,
            endMs: 25000,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);

  if (!response) {
    console.error("诊断请求也失败了，可能是网络问题。");
    return;
  }

  const body: unknown = await response.json().catch(() => null);
  const content = (body as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
    ?.message?.content;

  console.error("─".repeat(60));
  console.error("模型实际返回的内容：");
  console.error(content ?? JSON.stringify(body).slice(0, 800));
  console.error("─".repeat(60));

  // 拿真正的 schema 校验一遍，把不符的字段指出来，而不是让人肉眼比对
  if (content) {
    try {
      const parsed: unknown = JSON.parse(content);
      const result = pointsSchema.safeParse(parsed);
      if (result.success) {
        console.error("这次返回**通过**了结构校验——说明上一次失败是偶发的，重跑一次看看。");
        const points = result.data;
        const empty =
          points.summaryPoints.length === 0 &&
          points.discussionPoints.length === 0 &&
          points.resolutions.length === 0 &&
          points.tasks.length === 0 &&
          points.openIssues.length === 0;
        if (empty) {
          console.error("");
          console.error("但**五个字段全是空的**：模型没从转写里提取出任何要点。");
          console.error("结构合法所以校验能过，可实际拿不到纪要——这是提示词的问题，不是配置的问题。");
        }
        return;
      }
      console.error("结构校验失败的具体位置：");
      for (const issue of result.error.issues) {
        console.error(`  ${issue.path.join(".") || "(顶层)"}: ${issue.message}`);
      }
      return;
    } catch {
      console.error("返回的内容不是合法 JSON——该模型可能不支持 response_format: json_object。");
      return;
    }
  }

  console.error("对照期望的结构：");
  console.error(
    JSON.stringify(
      {
        summaryPoints: ["字符串"],
        discussionPoints: ["字符串"],
        resolutions: [{ text: "字符串", assignee: "字符串", dueDate: "2026-08-05 或 null" }],
        tasks: [{ title: "字符串", assignee: "字符串", dueDate: null, selected: true }],
        openIssues: [{ text: "字符串" }],
      },
      null,
      2,
    ),
  );
  console.error("");
  console.error("注意 resolutions / tasks / openIssues 的元素是**对象**，不是字符串；");
  console.error("而且 schema 是 strict 的，多一个字段也会被拒。");
}

main().catch(async (error: unknown) => {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : String(error);

  console.error(`smoke 失败：${message}${code ? `（${code}）` : ""}`);

  if (code === "MINUTES_INVALID_RESPONSE") {
    console.error("");
    console.error("正在取回模型的原始输出以便定位 …");
    await diagnose();
    process.exitCode = 1;
    return;
  }

  console.error("");
  console.error("常见原因：");
  console.error("  MINUTES_HTTP_401  密钥不对，或没带够权限");
  console.error("  MINUTES_HTTP_402  余额不足，去服务商控制台充值");
  console.error("  MINUTES_HTTP_404  地址填错了——base URL 不要带 /chat/completions，代码会自己拼");
  console.error("  MINUTES_INVALID   模型返回的不是合法 JSON。**该模型可能不支持 response_format: json_object**，换一个支持的");
  console.error("  MINUTES_NETWORK   网络不通或超时（服务器在境内时注意境外服务的连通性）");
  process.exitCode = 1;
});
