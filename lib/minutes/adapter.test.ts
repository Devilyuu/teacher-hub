import { describe, expect, test, vi } from "vitest";
import {
  createFakeMinutesAdapter,
  createOpenAICompatibleMinutesAdapter,
  minutesAdapterFromEnv,
  MinutesAdapterError,
} from "./adapter";

const points = {
  summaryPoints: ["确认交付安排"],
  discussionPoints: ["讨论上线风险"],
  resolutions: [{ text: "先内测", assignee: "我", dueDate: null }],
  tasks: [{ title: "整理结果", assignee: "我", dueDate: "2026-08-06", selected: true }],
  openIssues: [{ text: "是否扩大试点" }],
};

const merged = {
  summary: "确认交付安排",
  discussion: "讨论上线风险",
  resolutions: points.resolutions,
  tasks: points.tasks,
  openIssues: points.openIssues,
};

function completion(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("minutes adapters", () => {
  test("fake adapter implements both structured stages", async () => {
    const adapter = createFakeMinutesAdapter();
    const chunk = await adapter.summarizeChunk({ text: "会议正文", startMs: 0, endMs: 1000 });
    const draft = await adapter.mergePoints([chunk]);

    expect(adapter.provider).toBe("fake");
    expect(draft.summary.length).toBeGreaterThan(0);
    expect(draft.tasks[0]?.selected).toBe(true);
  });

  test("real adapter sends two OpenAI-compatible JSON requests", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(completion(points))
      .mockResolvedValueOnce(completion(merged));
    const adapter = createOpenAICompatibleMinutesAdapter({
      baseUrl: "https://minutes.example.test/v1",
      apiKey: "secret-key",
      model: "minutes-model",
      fetchImpl,
    });

    const chunkPoints = await adapter.summarizeChunk({ text: "敏感会议正文", startMs: 0, endMs: 1000 });
    const draft = await adapter.mergePoints([chunkPoints]);

    expect(draft.summary).toBe("确认交付安排");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://minutes.example.test/v1/chat/completions");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "minutes-model", response_format: { type: "json_object" } });
  });

  test("invalid provider JSON fails closed without echoing sensitive input or credentials", async () => {
    const adapter = createOpenAICompatibleMinutesAdapter({
      baseUrl: "https://minutes.example.test/v1",
      apiKey: "do-not-leak",
      model: "minutes-model",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "```json\n{broken}\n```" } }],
      })),
    });

    const error = await adapter.summarizeChunk({
      text: "绝密正文 C:/private/audio.mp3",
      startMs: 0,
      endMs: 1000,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(MinutesAdapterError);
    expect(error.code).toBe("MINUTES_INVALID_RESPONSE");
    expect(error.message).not.toContain("绝密正文");
    expect(error.message).not.toContain("do-not-leak");
    expect(error.message).not.toContain("C:/private");
  });

  test("manual fallback is selected when all minutes settings are absent", () => {
    expect(minutesAdapterFromEnv({})).toBeNull();
  });

  test("rejects partial settings and non-http base URLs", () => {
    expect(() => minutesAdapterFromEnv({ MINUTES_API_KEY: "key" })).toThrow("纪要服务配置不完整");
    expect(() => minutesAdapterFromEnv({
      MINUTES_API_BASE_URL: "file:///private/model",
      MINUTES_API_KEY: "key",
      MINUTES_MODEL: "model",
    })).toThrow("纪要服务地址必须使用 http 或 https");
  });
});
