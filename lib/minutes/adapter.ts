import "server-only";

import { z } from "zod";
import { generatedMinutesDraftSchema, type GeneratedMinutesDraft } from "./schema";
import type { TranscriptChunk } from "./chunking";

const nullableDueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
/** 导出供 `scripts/smoke-minutes.ts` 在配置阶段定位结构不符的具体字段 */
export const pointsSchema = z.object({
  summaryPoints: z.array(z.string().trim().min(1)).max(100),
  discussionPoints: z.array(z.string().trim().min(1)).max(100),
  resolutions: z.array(z.object({
    text: z.string().trim().min(1),
    assignee: z.string().trim().min(1).default("我"),
    dueDate: nullableDueDate.default(null),
  }).strict()).max(100),
  tasks: z.array(z.object({
    title: z.string().trim().min(1),
    assignee: z.string().trim().min(1).default("我"),
    dueDate: nullableDueDate.default(null),
    selected: z.boolean().default(true),
  }).strict()).max(100),
  openIssues: z.array(z.object({ text: z.string().trim().min(1) }).strict()).max(100),
}).strict();

export type MinutesPoints = z.infer<typeof pointsSchema>;

export type MinutesAdapter = {
  provider: string;
  summarizeChunk(chunk: TranscriptChunk): Promise<MinutesPoints>;
  mergePoints(points: MinutesPoints[]): Promise<GeneratedMinutesDraft>;
};

export class MinutesAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "MinutesAdapterError";
  }
}

export function createFakeMinutesAdapter(): MinutesAdapter {
  return {
    provider: "fake",
    async summarizeChunk() {
      return {
        summaryPoints: ["会议内容已整理"],
        discussionPoints: ["已根据转写提取讨论要点"],
        resolutions: [{ text: "确认后续安排", assignee: "我", dueDate: null }],
        tasks: [{ title: "跟进会议安排", assignee: "我", dueDate: null, selected: true }],
        openIssues: [],
      };
    },
    async mergePoints(points) {
      const merged = points.flatMap((point) => point.summaryPoints);
      return {
        summary: merged.join("；") || "会议内容已整理",
        discussion: points.flatMap((point) => point.discussionPoints).join("；"),
        resolutions: points.flatMap((point) => point.resolutions),
        tasks: points.flatMap((point) => point.tasks),
        openIssues: points.flatMap((point) => point.openIssues),
      };
    },
  };
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OpenAIOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
};

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

function endpointFromBase(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error("纪要服务地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("纪要服务地址必须使用 http 或 https");
  }
  if (url.username || url.password) throw new Error("纪要服务地址不得包含凭据");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * 提示词要把**元素形状**说死，光报字段名不够。
 *
 * 实测（DeepSeek）：只说"输出 summaryPoints、discussionPoints、resolutions、tasks、
 * openIssues"时，模型会把 discussionPoints 输出成 `{topic, details}` 对象、
 * 把 tasks 的 title 写成 description、给 assignee 填 null——内容提取得对，
 * 结构全不对，而 schema 是 strict 的，整份返回作废。
 *
 * 日期那条尤其要紧：模型不知道会议实际发生在哪天，看到"下周三"会**凭空算一个
 * 日期出来**（实测编成了前一年的某天）。那正是 CLAUDE.md 第 8 条禁止的
 * "把模糊日期硬转成精确日期"。宁可留 null 让用户自己填。
 */
const SHARED_RULES = [
  "硬性要求：",
  "- tasks 的键是 title，不是 description；resolutions 和 openIssues 的键是 text。",
  '- assignee 无法从原文确定时填 "我"，不要填 null。',
  "- 不要输出上面没列出的任何字段，多一个键整份结果都会被拒绝。",
  "- 不得补造原文没有的事实；原文没有的部分给空数组。",
].join("\n");

export const CHUNK_SYSTEM_PROMPT = [
  "你是会议纪要助手。输入是一段中文会议转写的 JSON，正文在 text 字段里。",
  "把它提取成 JSON 要点，只输出下面五个字段：",
  "",
  "{",
  '  "summaryPoints": ["一句话要点"],',
  '  "discussionPoints": ["一句话讨论点"],',
  '  "resolutions": [{"text": "决议内容", "assignee": "负责人", "dueDate": null}],',
  '  "tasks": [{"title": "待办标题", "assignee": "负责人", "dueDate": null, "selected": true}],',
  '  "openIssues": [{"text": "未决事项"}]',
  "}",
  "",
  "summaryPoints 和 discussionPoints 是**字符串数组**，元素不是对象。",
  "",
  SHARED_RULES,
  '- dueDate：只有转写里出现明确日期（如"3月5日""2026-03-05"）时才填 YYYY-MM-DD。',
  '  "下周三""月底"这类相对表述一律填 null——你不知道会议的实际日期，推算出来的一定是错的。',
].join("\n");

const MERGE_SYSTEM_PROMPT = [
  "合并会议分段要点，去重后输出一份 JSON 纪要。只输出下面五个字段：",
  "",
  "{",
  '  "summary": "整场会议的摘要，纯文本",',
  '  "discussion": "讨论过程的叙述，纯文本",',
  '  "resolutions": [{"text": "决议内容", "assignee": "负责人", "dueDate": null}],',
  '  "tasks": [{"title": "待办标题", "assignee": "负责人", "dueDate": null, "selected": true}],',
  '  "openIssues": [{"text": "未决事项"}]',
  "}",
  "",
  "summary 和 discussion 是**字符串**，不是数组。",
  "",
  SHARED_RULES,
  "- dueDate 原样保留输入里的值：输入是 null 就保持 null，不要自己推算日期。",
].join("\n");

export function createOpenAICompatibleMinutesAdapter(options: OpenAIOptions): MinutesAdapter {
  const endpoint = endpointFromBase(options.baseUrl);
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  if (!apiKey || !model) throw new Error("纪要服务配置不完整");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function call<T>(system: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(input) },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new MinutesAdapterError("MINUTES_NETWORK", "纪要服务暂时不可用");
    }
    if (!response.ok) {
      throw new MinutesAdapterError(`MINUTES_HTTP_${response.status}`, `纪要服务请求失败（HTTP ${response.status}）`);
    }
    try {
      const completion = completionSchema.parse(await response.json());
      return schema.parse(JSON.parse(completion.choices[0]!.message.content));
    } catch {
      throw new MinutesAdapterError("MINUTES_INVALID_RESPONSE", "纪要服务返回了无法验证的结构");
    }
  }

  return {
    provider: "openai-compatible",
    summarizeChunk(chunk) {
      return call(CHUNK_SYSTEM_PROMPT, chunk, pointsSchema);
    },
    mergePoints(points) {
      return call(MERGE_SYSTEM_PROMPT, points, generatedMinutesDraftSchema);
    },
  };
}

export function minutesAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: FetchLike,
): MinutesAdapter | null {
  if (env.MINUTES_ADAPTER === "fake") return createFakeMinutesAdapter();
  const baseUrl = env.MINUTES_API_BASE_URL?.trim() ?? "";
  const apiKey = env.MINUTES_API_KEY?.trim() ?? "";
  const model = env.MINUTES_MODEL?.trim() ?? "";
  if (!baseUrl && !apiKey && !model) return null;
  if (!baseUrl || !apiKey || !model) throw new Error("纪要服务配置不完整");
  return createOpenAICompatibleMinutesAdapter({ baseUrl, apiKey, model, fetchImpl });
}
