import { describe, expect, test, vi } from "vitest";
import {
  addMeetingResolution,
  convertMeetingResolutionToTask,
  removeMeetingResolution,
  saveMeetingMinutes,
} from "./meeting-mutations";

function clientWithLockedMeeting(meetings: Array<{ id: string; minutes: string | null; resolutions: unknown }>) {
  let lockIndex = 0;
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      expect(strings.join("?")).toContain("FOR UPDATE");
      const meeting = meetings[Math.min(lockIndex, meetings.length - 1)];
      lockIndex += 1;
      return meeting ? [meeting] : [];
    }),
    meeting: { update: vi.fn(async () => ({})) },
    task: { create: vi.fn(async () => ({ id: "task-created" })) },
  };
  const client = { $transaction: vi.fn(async (callback) => callback(tx)) };
  return { client, tx };
}

function legacySnapshot(resolution: { text: string; assignee: string; dueDate: string | null; convertedTaskId: string | null }) {
  return { kind: "legacy" as const, ...resolution };
}

describe("locked meeting mutations", () => {
  test("rejects a stale minutes form instead of overwriting newer automatic content", async () => {
    const { client, tx } = clientWithLockedMeeting([{ id: "meeting-1", minutes: "服务器新值", resolutions: [] }]);

    await expect(saveMeetingMinutes(client as never, "meeting-1", "旧页面值", "用户编辑"))
      .resolves.toBe("conflict");
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });

  test("accepts an original minutes snapshot that differs only by CRLF", async () => {
    const { client, tx } = clientWithLockedMeeting([{
      id: "meeting-1",
      minutes: "第一行\n第二行",
      resolutions: [],
    }]);

    await expect(saveMeetingMinutes(client as never, "meeting-1", "第一行\r\n第二行", "用户新内容"))
      .resolves.toBe("saved");
    expect(tx.meeting.update).toHaveBeenCalledWith(expect.objectContaining({ data: { minutes: "用户新内容" } }));
  });

  test("still rejects a snapshot with a real content change after line ending normalization", async () => {
    const { client, tx } = clientWithLockedMeeting([{
      id: "meeting-1",
      minutes: "第一行\n服务器新增",
      resolutions: [],
    }]);

    await expect(saveMeetingMinutes(client as never, "meeting-1", "第一行\r\n旧内容", "用户新内容"))
      .resolves.toBe("conflict");
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });

  test("adds and removes resolutions from the value read under the meeting lock", async () => {
    const existing = [{ text: "已有", assignee: "我", dueDate: null, convertedTaskId: null }];
    const { client, tx } = clientWithLockedMeeting([
      { id: "meeting-1", minutes: null, resolutions: existing },
      { id: "meeting-1", minutes: null, resolutions: [...existing, { text: "并发新增", assignee: "我", dueDate: null, convertedTaskId: null }] },
    ]);

    await addMeetingResolution(client as never, "meeting-1", {
      text: "我的新增", assignee: "我", dueDate: null, convertedTaskId: null,
    });
    await removeMeetingResolution(client as never, "meeting-1", 0, legacySnapshot(existing[0]!));

    expect(tx.meeting.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: { resolutions: expect.arrayContaining([expect.objectContaining({ text: "已有" }), expect.objectContaining({ text: "我的新增" })]) },
    }));
    expect(tx.meeting.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { resolutions: [expect.objectContaining({ text: "并发新增" })] },
    }));
  });

  test("concurrent conversion rechecks convertedTaskId under lock and creates one task", async () => {
    const pending = [{ text: "转任务", assignee: "我", dueDate: null, convertedTaskId: null }];
    const converted = [{ text: "转任务", assignee: "我", dueDate: null, convertedTaskId: "task-created" }];
    const { client, tx } = clientWithLockedMeeting([
      { id: "meeting-1", minutes: null, resolutions: pending },
      { id: "meeting-1", minutes: null, resolutions: converted },
    ]);

    const expected = legacySnapshot(pending[0]!);
    const first = await convertMeetingResolutionToTask(client as never, "meeting-1", 0, expected);
    const second = await convertMeetingResolutionToTask(client as never, "meeting-1", 0, expected);

    expect(first).toMatchObject({ status: "converted", taskId: "task-created" });
    expect(second).toMatchObject({ status: "already-converted", taskId: "task-created" });
    expect(tx.task.create).toHaveBeenCalledTimes(1);
  });

  test("preserves invalid legacy elements and unknown fields when adding", async () => {
    const raw = [
      "保留字符串旧元素",
      { text: "已有", assignee: "我", dueDate: null, convertedTaskId: null, note: "保留备注" },
      { malformed: true },
    ];
    const { client, tx } = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: raw }]);
    const added = { text: "新增", assignee: "我", dueDate: null, convertedTaskId: null };

    await expect(addMeetingResolution(client as never, "meeting-1", added)).resolves.toBe("added");
    expect(tx.meeting.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { resolutions: [...raw, added] },
    }));
  });

  test("maps a displayed index to its raw element and preserves every other raw value", async () => {
    const target = { text: "页面目标", assignee: "我", dueDate: null, convertedTaskId: null, note: "目标备注" };
    const survivor = { text: "保留决议", assignee: "你", dueDate: "2026-08-09", convertedTaskId: null, note: "保留" };
    const raw = ["无效前缀", target, { malformed: true }, survivor];
    const { client, tx } = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: raw }]);

    await expect(removeMeetingResolution(client as never, "meeting-1", 0, {
      kind: "legacy",
      text: target.text,
      assignee: target.assignee,
      dueDate: target.dueDate,
      convertedTaskId: target.convertedTaskId,
    } as never)).resolves.toBe("removed");
    expect(tx.meeting.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { resolutions: ["无效前缀", { malformed: true }, survivor] },
    }));
  });

  test("rejects a stale displayed index instead of deleting or converting a different resolution", async () => {
    const current = { text: "决议 C", assignee: "我", dueDate: null, convertedTaskId: null };
    const expectedB = {
      kind: "legacy",
      text: "决议 B",
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    };
    const remove = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: [current] }]);
    const convert = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: [current] }]);

    await expect(removeMeetingResolution(remove.client as never, "meeting-1", 0, expectedB as never))
      .resolves.toBe("conflict");
    await expect(convertMeetingResolutionToTask(convert.client as never, "meeting-1", 0, expectedB as never))
      .resolves.toMatchObject({ status: "conflict" });
    expect(remove.tx.meeting.update).not.toHaveBeenCalled();
    expect(convert.tx.meeting.update).not.toHaveBeenCalled();
    expect(convert.tx.task.create).not.toHaveBeenCalled();
  });

  test("shallow-merges convertedTaskId into the exact raw object without losing note or invalid entries", async () => {
    const target = {
      recordingId: "recording-1",
      candidateId: "candidate-1",
      text: "自动决议",
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
      note: "必须保留",
    };
    const raw = [17, target, { malformed: true }];
    const { client, tx } = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: raw }]);

    await expect(convertMeetingResolutionToTask(client as never, "meeting-1", 0, {
      kind: "automatic",
      recordingId: target.recordingId,
      candidateId: target.candidateId,
    } as never)).resolves.toMatchObject({ status: "converted", taskId: "task-created" });
    expect(tx.meeting.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { resolutions: [17, { ...target, convertedTaskId: "task-created" }, { malformed: true }] },
    }));
  });

  test("treats a concurrently converted matching identity as idempotent", async () => {
    const converted = {
      text: "同一旧决议",
      assignee: "我",
      dueDate: null,
      convertedTaskId: "task-existing",
      note: "保留",
    };
    const { client, tx } = clientWithLockedMeeting([{ id: "meeting-1", minutes: null, resolutions: [converted] }]);

    await expect(convertMeetingResolutionToTask(client as never, "meeting-1", 0, {
      kind: "legacy",
      text: converted.text,
      assignee: converted.assignee,
      dueDate: converted.dueDate,
      convertedTaskId: null,
    } as never)).resolves.toEqual({ status: "already-converted", taskId: "task-existing" });
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });
});
