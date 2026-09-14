import { describe, expect, test } from "vitest";
import {
  createManualMinutesDraft,
  minutesDraftSchema,
  withStableCandidateIds,
} from "./schema";

describe("minutes draft schema", () => {
  test("assigns deterministic stable ids to generated candidates", () => {
    const generated = {
      summary: "本次会议确认了交付安排。",
      discussion: "讨论了上线风险。",
      resolutions: [{ text: "先完成内测", assignee: "我", dueDate: "2026-08-05" }],
      tasks: [{ title: "整理测试结果", assignee: "我", dueDate: "2026-08-06", selected: true }],
      openIssues: [{ text: "是否扩大试点" }],
    };

    const first = withStableCandidateIds(generated);
    const second = withStableCandidateIds(generated);

    expect(first).toEqual(second);
    expect(first.resolutions[0]?.id).toMatch(/^resolution-/);
    expect(first.tasks[0]?.id).toMatch(/^task-/);
    expect(first.openIssues[0]?.id).toMatch(/^issue-/);
    expect(minutesDraftSchema.parse(first)).toEqual(first);
  });

  test("preserves candidate ids while a manual draft is edited", () => {
    const draft = withStableCandidateIds({
      summary: "初稿",
      discussion: "讨论",
      resolutions: [],
      tasks: [{ title: "整理结果", assignee: "我", dueDate: null, selected: false }],
      openIssues: [],
    });
    const edited = minutesDraftSchema.parse({
      ...draft,
      tasks: [{ ...draft.tasks[0], title: "整理并发送结果", selected: true }],
    });

    expect(edited.tasks[0]?.id).toBe(draft.tasks[0]?.id);
  });

  test("persists the created task id after transactional confirmation", () => {
    const draft = withStableCandidateIds({
      summary: "摘要",
      discussion: "讨论",
      resolutions: [],
      tasks: [{ title: "整理结果", assignee: "我", dueDate: null, selected: true }],
      openIssues: [],
    });

    expect(minutesDraftSchema.parse({
      ...draft,
      tasks: [{ ...draft.tasks[0], createdTaskId: "task-created-1" }],
    }).tasks[0]?.createdTaskId).toBe("task-created-1");
  });

  test("manual fallback starts with an editable empty structure", () => {
    expect(createManualMinutesDraft()).toEqual({
      summary: "",
      discussion: "",
      resolutions: [],
      tasks: [],
      openIssues: [],
    });
  });

  test("rejects invalid due dates and unknown fields", () => {
    expect(() => minutesDraftSchema.parse({
      summary: "摘要",
      discussion: "讨论",
      resolutions: [],
      tasks: [{ id: "task-1", title: "任务", assignee: "我", dueDate: "2026-02-30", selected: true }],
      openIssues: [],
      transcript: "不得混进草稿",
    })).toThrow();
  });
});
