import { describe, expect, test, vi } from "vitest";
import { createFakeMinutesAdapter, MinutesAdapterError } from "./adapter";
import {
  confirmRecordingMinutes,
  generateRecordingMinutes,
  initializeManualMinutesDraft,
  saveRecordingMinutesDraft,
  type MinutesRepository,
} from "./service";
import { withStableCandidateIds } from "./schema";

function draft() {
  return withStableCandidateIds({
    summary: "最新摘要",
    discussion: "最新讨论",
    resolutions: [],
    tasks: [{ title: "最新任务", assignee: "我", dueDate: null, selected: true }],
    openIssues: [],
  });
}

function repository(overrides: Partial<MinutesRepository> = {}): MinutesRepository {
  return {
    async getDraftSource() {
      return {
        transcript: "第一段。第二段。",
        transcriptSegments: [
          { text: "第一段。", startMs: 0, endMs: 1000, speakerId: 0 },
          { text: "第二段。", startMs: 1000, endMs: 2000, speakerId: 0 },
        ],
        confirmedAt: null,
      };
    },
    saveDraft: vi.fn(async () => true),
    recordGenerationFailure: vi.fn(async () => true),
    confirm: vi.fn(async () => ({ alreadyConfirmed: false, needsAudioCleanup: true, taskIds: ["task-1"] })),
    ...overrides,
  };
}

describe("minutes service", () => {
  test("runs chunk extraction then merge and persists stable candidate ids", async () => {
    const repo = repository();
    const adapter = createFakeMinutesAdapter();

    const result = await generateRecordingMinutes("recording-1", {
      repository: repo,
      adapter,
      maxChars: 5,
    });

    expect(result.mode).toBe("generated");
    expect(result.draft.tasks[0]?.id).toMatch(/^task-/);
    expect(repo.saveDraft).toHaveBeenCalledWith("recording-1", result.draft);
  });

  test("uses the transcript when providers returned no segments", async () => {
    const repo = repository({
      async getDraftSource() {
        return { transcript: "只有完整转写", transcriptSegments: [], confirmedAt: null };
      },
    });
    const summarizeChunk = vi.fn(createFakeMinutesAdapter().summarizeChunk);
    const adapter = { ...createFakeMinutesAdapter(), summarizeChunk };

    await generateRecordingMinutes("recording-1", { repository: repo, adapter });

    expect(summarizeChunk).toHaveBeenCalledWith(expect.objectContaining({ text: "只有完整转写" }));
  });

  test("provider failure records only a minutes error and leaves the transcript reusable", async () => {
    const repo = repository();
    const failure = new MinutesAdapterError("MINUTES_INVALID_RESPONSE", "纪要服务返回了无法验证的结构");
    const adapter = { ...createFakeMinutesAdapter(), summarizeChunk: vi.fn(async () => { throw failure; }) };

    await expect(generateRecordingMinutes("recording-1", { repository: repo, adapter })).rejects.toBe(failure);

    expect(repo.recordGenerationFailure).toHaveBeenCalledWith("recording-1", {
      errorCode: "MINUTES_INVALID_RESPONSE",
      errorNote: "纪要生成失败，可重试或手工整理",
    });
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  test("unconfigured service initializes and persists the manual fallback", async () => {
    const repo = repository();
    const result = await initializeManualMinutesDraft("recording-1", repo);

    expect(result).toEqual({ summary: "", discussion: "", resolutions: [], tasks: [], openIssues: [] });
    expect(repo.saveDraft).toHaveBeenCalledWith("recording-1", result);
  });

  test("manual draft save rejects fields outside the persisted contract", async () => {
    const repo = repository();
    await expect(saveRecordingMinutesDraft("recording-1", {
      summary: "摘要",
      discussion: "讨论",
      resolutions: [],
      tasks: [],
      openIssues: [],
      transcript: "不应由客户端回写",
    }, repo)).rejects.toThrow();
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  test("manual draft save cannot forge a created task id", async () => {
    const repo = repository();
    await expect(saveRecordingMinutesDraft("recording-1", {
      summary: "摘要",
      discussion: "讨论",
      resolutions: [],
      tasks: [{
        id: "task-1",
        title: "任务",
        assignee: "我",
        dueDate: null,
        selected: true,
        createdTaskId: "forged-task-id",
      }],
      openIssues: [],
    }, repo)).rejects.toThrow("任务回写标记不允许由客户端设置");
    expect(repo.saveDraft).not.toHaveBeenCalled();
  });

  test("confirmation commits first and reports post-commit deletion failure as pending", async () => {
    const repo = repository();
    const removeAudio = vi.fn(async () => { throw new Error("C:/private/audio.wav"); });
    const currentDraft = draft();

    const result = await confirmRecordingMinutes("recording-1", currentDraft, {
      repository: repo,
      removeAudio,
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    expect(repo.confirm).toHaveBeenCalledWith(
      "recording-1",
      currentDraft,
      new Date("2026-08-03T00:00:00.000Z"),
    );
    expect(removeAudio).toHaveBeenCalledWith("recording-1");
    expect(result).toEqual({ alreadyConfirmed: false, taskIds: ["task-1"], audio: "pending" });
  });

  test("idempotent confirmation does not start another deletion when audio is already absent", async () => {
    const repo = repository({
      confirm: vi.fn(async () => ({ alreadyConfirmed: true, needsAudioCleanup: false, taskIds: ["task-1"] })),
    });
    const removeAudio = vi.fn();

    const result = await confirmRecordingMinutes("recording-1", draft(), { repository: repo, removeAudio });

    expect(removeAudio).not.toHaveBeenCalled();
    expect(result).toEqual({ alreadyConfirmed: true, taskIds: ["task-1"], audio: "absent" });
  });

  test("confirmation rejects forged task ids before entering the transaction", async () => {
    const repo = repository();
    const forged = draft();
    forged.tasks[0]!.createdTaskId = "task-from-another-tab";

    await expect(confirmRecordingMinutes("recording-1", forged, {
      repository: repo,
      removeAudio: vi.fn(),
    })).rejects.toThrow("任务回写标记不允许由客户端设置");

    expect(repo.confirm).not.toHaveBeenCalled();
  });
});
