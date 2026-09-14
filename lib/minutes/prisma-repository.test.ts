import { describe, expect, test, vi } from "vitest";
import { withStableCandidateIds } from "./schema";
import { createPrismaMinutesRepository } from "./prisma-repository";

function draft() {
  return withStableCandidateIds({
    summary: "确认交付安排",
    discussion: "讨论上线风险",
    resolutions: [{ text: "先内测", assignee: "我", dueDate: null }],
    tasks: [
      { title: "整理结果", assignee: "我", dueDate: "2026-08-06", selected: true },
      { title: "暂不执行", assignee: "我", dueDate: null, selected: false },
    ],
    openIssues: [{ text: "是否扩大试点" }],
  });
}

function lockedRow(overrides: Record<string, unknown> = {}) {
  const value = draft();
  return {
    id: "recording-1",
    meetingId: "meeting-1",
    originalName: "第一段.wav",
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    status: "DRAFT_READY",
    transcript: "转写正文",
    draftSummary: value.summary,
    draftDiscussion: value.discussion,
    draftResolutions: value.resolutions,
    draftTasks: value.tasks,
    draftOpenIssues: value.openIssues,
    confirmedAt: null,
    audioDeletedAt: null,
    storagePath: "recording-1/audio.wav",
    ...overrides,
  };
}

describe("Prisma minutes repository", () => {
  test("saves draft fields while preserving audio deletion work states", async () => {
    const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain("CASE");
      expect(sql).toContain("DELETE_PENDING");
      expect(sql).toContain("AUDIO_DELETED");
      expect(sql).toContain('"confirmedAt" IS NULL');
      return 1;
    });
    const repository = createPrismaMinutesRepository({ $executeRaw: executeRaw } as never);

    await expect(repository.saveDraft("recording-1", draft())).resolves.toBe(true);
  });

  test("records generation failure without changing recording status", async () => {
    const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain("CASE");
      expect(sql).toContain("DELETE_PENDING");
      expect(sql).not.toContain('SET "status"');
      return 1;
    });
    const repository = createPrismaMinutesRepository({ $executeRaw: executeRaw } as never);

    await expect(repository.recordGenerationFailure("recording-1", {
      errorCode: "MINUTES_INVALID_RESPONSE",
      errorNote: "纪要生成失败，可重试或手工整理",
    })).resolves.toBe(true);
  });

  test("locks the recording and atomically writes formal minutes, selected tasks and confirmedAt", async () => {
    const taskCreate = vi.fn(async () => ({ id: "created-task-1" }));
    const meetingUpdate = vi.fn(async () => ({}));
    const recordingUpdate = vi.fn(async () => ({}));
    let queryIndex = 0;
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        queryIndex += 1;
        if (queryIndex === 1) return [{ meetingId: "meeting-1" }];
        expect(sql).toContain("FOR UPDATE");
        if (queryIndex === 2) return [{ id: "meeting-1" }];
        return [lockedRow()];
      }),
      task: { create: taskCreate },
      meeting: { update: meetingUpdate },
      meetingRecording: {
        update: recordingUpdate,
        findMany: vi.fn(async () => [lockedRow({
          confirmedAt: new Date("2026-08-03T00:00:00.000Z"),
          draftTasks: [{ ...draft().tasks[0], createdTaskId: "created-task-1" }, draft().tasks[1]],
        })]),
      },
    };
    const client = { $transaction: vi.fn(async (callback) => callback(tx)) };
    const repository = createPrismaMinutesRepository(client as never);
    const now = new Date("2026-08-03T00:00:00.000Z");

    const currentDraft = draft();
    const result = await repository.confirm("recording-1", currentDraft, now);

    expect(result).toEqual({ alreadyConfirmed: false, needsAudioCleanup: true, taskIds: ["created-task-1"] });
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(taskCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      title: "整理结果",
      source: "MEETING",
      sourceMeetingId: "meeting-1",
      dueDate: new Date("2026-08-06T00:00:00.000Z"),
    }), select: { id: true } });
    expect(meetingUpdate).toHaveBeenCalledWith({
      where: { id: "meeting-1" },
      data: {
        minutes: expect.stringContaining("确认交付安排"),
        resolutions: [expect.objectContaining({
          recordingId: "recording-1",
          candidateId: currentDraft.resolutions[0]!.id,
          text: "先内测",
          convertedTaskId: null,
        })],
      },
    });
    expect(recordingUpdate).toHaveBeenCalledWith({
      where: { id: "recording-1" },
      data: expect.objectContaining({
        draftSummary: currentDraft.summary,
        draftDiscussion: currentDraft.discussion,
        draftResolutions: currentDraft.resolutions,
        confirmedAt: now,
        status: "CONFIRMED",
        draftTasks: expect.arrayContaining([expect.objectContaining({ createdTaskId: "created-task-1" })]),
      }),
    });
  });

  test("repeated confirmation returns persisted task ids without writing again", async () => {
    const value = draft();
    value.tasks[0]!.createdTaskId = "created-task-1";
    let queryIndex = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        queryIndex += 1;
        if (queryIndex === 1) return [{ meetingId: "meeting-1" }];
        if (queryIndex === 2) return [{ id: "meeting-1" }];
        return [lockedRow({
          status: "AUDIO_DELETED",
          confirmedAt: new Date("2026-08-03T00:00:00.000Z"),
          audioDeletedAt: new Date("2026-08-03T00:01:00.000Z"),
          storagePath: null,
          draftTasks: value.tasks,
        })];
      }),
      task: { create: vi.fn() },
      meeting: { update: vi.fn() },
      meetingRecording: { update: vi.fn(), findMany: vi.fn() },
    };
    const repository = createPrismaMinutesRepository({ $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as never);

    await expect(repository.confirm("recording-1", draft(), new Date())).resolves.toEqual({
      alreadyConfirmed: true,
      needsAudioCleanup: false,
      taskIds: ["created-task-1"],
    });
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.meeting.update).not.toHaveBeenCalled();
    expect(tx.meetingRecording.update).not.toHaveBeenCalled();
  });

  test("confirmation never overwrites an in-flight deletion state", async () => {
    let queryIndex = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        queryIndex += 1;
        if (queryIndex === 1) return [{ meetingId: "meeting-1" }];
        if (queryIndex === 2) return [{ id: "meeting-1" }];
        return [lockedRow({ status: "DELETE_PENDING" })];
      }),
      task: { create: vi.fn(async () => ({ id: "created-task-1" })) },
      meeting: { update: vi.fn(async () => ({})) },
      meetingRecording: {
        update: vi.fn(async () => ({})),
        findMany: vi.fn(async () => [lockedRow({ confirmedAt: new Date() })]),
      },
    };
    const repository = createPrismaMinutesRepository({ $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as never);

    await repository.confirm("recording-1", draft(), new Date());

    expect(tx.meetingRecording.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELETE_PENDING" }),
    }));
  });

  test("does not confirm an empty manual placeholder", async () => {
    let queryIndex = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        queryIndex += 1;
        if (queryIndex === 1) return [{ meetingId: "meeting-1" }];
        if (queryIndex === 2) return [{ id: "meeting-1" }];
        return [lockedRow()];
      }),
      task: { create: vi.fn() },
      meeting: { update: vi.fn() },
      meetingRecording: { update: vi.fn(), findMany: vi.fn() },
    };
    const repository = createPrismaMinutesRepository({ $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as never);

    await expect(repository.confirm("recording-1", {
      summary: "",
      discussion: "",
      resolutions: [],
      tasks: [],
      openIssues: [],
    }, new Date())).rejects.toThrow("纪要草稿还是空的");
    expect(tx.meeting.update).not.toHaveBeenCalled();
    expect(tx.meetingRecording.update).not.toHaveBeenCalled();
  });

  test("rebuilds formal minutes from every confirmed recording without losing an earlier segment", async () => {
    const firstDraft = draft();
    firstDraft.summary = "第一段摘要";
    firstDraft.discussion = "第一段讨论";
    firstDraft.resolutions[0]!.text = "第一段决议";
    const secondDraft = draft();
    secondDraft.summary = "第二段摘要";
    secondDraft.discussion = "第二段讨论";
    secondDraft.resolutions[0]!.text = "第二段决议";
    secondDraft.tasks = [];
    let queryIndex = 0;
    const meetingUpdate = vi.fn(async () => ({}));
    const tx = {
      $queryRaw: vi.fn(async () => {
        queryIndex += 1;
        if (queryIndex === 1) return [{ meetingId: "meeting-1" }];
        if (queryIndex === 2) return [{ id: "meeting-1" }];
        return [lockedRow({
          id: "recording-2",
          originalName: "第二段.wav",
          createdAt: new Date("2026-08-03T01:00:00.000Z"),
        })];
      }),
      task: { create: vi.fn() },
      meeting: { update: meetingUpdate },
      meetingRecording: {
        update: vi.fn(async () => ({})),
        findMany: vi.fn(async () => [
          lockedRow({
            id: "recording-1",
            originalName: "第一段.wav",
            confirmedAt: new Date("2026-08-03T00:30:00.000Z"),
            draftSummary: firstDraft.summary,
            draftDiscussion: firstDraft.discussion,
            draftResolutions: firstDraft.resolutions,
            draftTasks: firstDraft.tasks,
            draftOpenIssues: firstDraft.openIssues,
          }),
          lockedRow({
            id: "recording-2",
            originalName: "第二段.wav",
            confirmedAt: new Date("2026-08-03T01:30:00.000Z"),
            draftSummary: secondDraft.summary,
            draftDiscussion: secondDraft.discussion,
            draftResolutions: secondDraft.resolutions,
            draftTasks: secondDraft.tasks,
            draftOpenIssues: secondDraft.openIssues,
          }),
        ]),
      },
    };
    const repository = createPrismaMinutesRepository({ $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as never);

    await repository.confirm("recording-2", secondDraft, new Date("2026-08-03T01:30:00.000Z"));

    const update = (meetingUpdate.mock.calls as unknown as Array<[{
      data: { minutes: string; resolutions: Array<Record<string, unknown>> };
    }]>)[0]![0];
    expect(update.data.minutes).toContain("第一段摘要");
    expect(update.data.minutes).toContain("第二段摘要");
    expect(update.data.minutes).toContain("recording-1");
    expect(update.data.minutes).toContain("recording-2");
    expect(update.data.resolutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordingId: "recording-1", text: "第一段决议" }),
      expect.objectContaining({ recordingId: "recording-2", text: "第二段决议" }),
    ]));
  });

  test("claims one manual deletion with a fresh fencing token", async () => {
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain('"status" NOT IN (\'UPLOADING\', \'TRANSCRIBING\', \'AUDIO_DELETED\')');
      expect(sql).toContain('"audioDeletedAt" IS NULL');
      expect(sql).toContain('"status" = \'DELETE_PENDING\'');
      expect(sql).toContain('"claimedAt" IS NULL');
      return [{ id: "recording-1", storagePath: "recording-safe/audio.wav", claimedAt: new Date() }];
    });
    const repository = createPrismaMinutesRepository({ $queryRaw: queryRaw } as never);

    await expect(repository.claimAudioDeletion("recording-1", new Date(), 30)).resolves.toMatchObject({ id: "recording-1" });
  });

  test("maintenance claims confirmed, successfully transcribed expired, and stale DELETE_PENDING rows", async () => {
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      expect(sql).toContain('r."confirmedAt" IS NOT NULL');
      expect(sql).toContain('r."transcript" IS NOT NULL');
      expect(sql).toContain('r."expiresAt" <=');
      expect(sql).toContain('r."status" = \'DELETE_PENDING\'');
      expect(sql).toContain('r."status" <> \'DELETE_PENDING\'');
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql).not.toContain('r."status" = \'FAILED\'');
      return [];
    });
    const repository = createPrismaMinutesRepository({ $queryRaw: queryRaw } as never);

    await repository.claimDueAudioDeletions(new Date(), 30, 20);
  });

  test("completes and fails deletion only through the claimedAt fence", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = createPrismaMinutesRepository({ meetingRecording: { updateMany } } as never);
    const claimedAt = new Date("2026-08-03T00:00:00.000Z");
    const deletedAt = new Date("2026-08-03T00:01:00.000Z");

    await repository.completeAudioDeletion("recording-1", claimedAt, deletedAt);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "recording-1", status: "DELETE_PENDING", claimedAt },
      data: {
        status: "AUDIO_DELETED",
        audioDeletedAt: deletedAt,
        storagePath: null,
        claimedAt: null,
        errorCode: null,
        errorNote: null,
      },
    });

    await repository.failAudioDeletion("recording-1", claimedAt);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "recording-1", status: "DELETE_PENDING", claimedAt },
      data: {
        errorCode: "AUDIO_DELETE_FAILED",
        errorNote: "音频删除失败，已进入维护重试队列",
      },
    });
  });
});
