import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 速记归类（lib/actions/capture-actions.ts）。速记是平台最高频的动作（CLAUDE.md），
 * 到 09-26 为止这 283 行一条单测都没有。
 *
 * 重点是 2026-09-26 补的「认领」：原来事务外查一次 status 就进事务建实体，
 * 双击或两个标签页同时点会建出两条、先建的成孤儿。现在事务里先
 * `updateMany where status != CONVERTED`，改到 0 行的那个请求不建任何东西
 */

const mocks = vi.hoisted(() => {
  const tx = {
    captureItem: { updateMany: vi.fn(), update: vi.fn() },
    task: { create: vi.fn() },
    achievement: { create: vi.fn() },
    meeting: { create: vi.fn() },
    studentRecord: { create: vi.fn() },
    menteeRecord: { create: vi.fn() },
  };
  return {
    tx,
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    transaction: vi.fn(),
    captureFindUnique: vi.fn(),
    classGroupFindUnique: vi.fn(),
    studentRecordTypeFindUnique: vi.fn(),
    studentFindUnique: vi.fn(),
    batchFindUnique: vi.fn(),
    menteeRecordTypeFindUnique: vi.fn(),
    menteeFindUnique: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    captureItem: { findUnique: mocks.captureFindUnique },
    classGroup: { findUnique: mocks.classGroupFindUnique },
    studentRecordType: { findUnique: mocks.studentRecordTypeFindUnique },
    student: { findUnique: mocks.studentFindUnique },
    menteeBatch: { findUnique: mocks.batchFindUnique },
    menteeRecordType: { findUnique: mocks.menteeRecordTypeFindUnique },
    mentee: { findUnique: mocks.menteeFindUnique },
  },
}));

import {
  convertCapture,
  convertCaptureToMenteeRecord,
  convertCaptureToStudentRecord,
} from "@/lib/actions/capture-actions";

const capture = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  kind: "TASK",
  status: "INBOX",
  title: "  催恒新公司出具首期验收意见 ",
  content: "周五前",
  ...overrides,
});

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx));
  mocks.tx.captureItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.task.create.mockResolvedValue({ id: "task-1" });
  mocks.tx.achievement.create.mockResolvedValue({ id: "achievement-1" });
  mocks.tx.studentRecord.create.mockResolvedValue({ id: "srec-1" });
  mocks.tx.menteeRecord.create.mockResolvedValue({ id: "mrec-1" });
  mocks.captureFindUnique.mockResolvedValue(capture());
});

describe("convertCapture", () => {
  it("先认领再建任务，转换指针指向新任务", async () => {
    const state = await convertCapture("c1");

    expect(state).toMatchObject({ ok: true, message: "已转为正式记录" });
    expect(mocks.tx.captureItem.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", status: { not: "CONVERTED" } },
      data: { status: "CONVERTED", handledAt: expect.any(Date) },
    });
    expect(mocks.tx.task.create).toHaveBeenCalledWith({
      data: { title: "催恒新公司出具首期验收意见", note: "周五前", source: "SELF" },
    });
    expect(mocks.tx.captureItem.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { convertedTaskId: "task-1" },
    });
    // 认领必须在建实体之前，否则并发的两个都会先建出来
    expect(mocks.tx.captureItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.task.create.mock.invocationCallOrder[0],
    );
  });

  /** 双击、两个标签页：两个请求都读到「未转」，只有认领成功的那个能建 */
  it("并发里慢一步的那个认领落空，什么都不建，照实说已经转过了", async () => {
    mocks.tx.captureItem.updateMany.mockResolvedValue({ count: 0 });

    const state = await convertCapture("c1");

    expect(state).toMatchObject({ ok: true, message: "这条已经转过了" });
    expect(mocks.tx.task.create).not.toHaveBeenCalled();
    expect(mocks.tx.captureItem.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("早就转过的不进事务", async () => {
    mocks.captureFindUnique.mockResolvedValue(capture({ status: "CONVERTED" }));
    const state = await convertCapture("c1");
    expect(state.message).toBe("这条已经转过了");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  /** 还没人核过，应该出现在「待核实」里等着补全，不冒充可信记录 */
  it("成果类速记转成待核实的成果", async () => {
    mocks.captureFindUnique.mockResolvedValue(capture({ kind: "ACHIEVEMENT", content: null }));
    await convertCapture("c1");
    expect(mocks.tx.achievement.create).toHaveBeenCalledWith({
      data: { title: "催恒新公司出具首期验收意见", note: null, type: "OTHER", isVerified: false },
    });
    expect(mocks.tx.captureItem.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { convertedAchievementId: "achievement-1" },
    });
  });

  it("速记已经被删了就照实说", async () => {
    mocks.captureFindUnique.mockResolvedValue(null);
    expect(await convertCapture("gone")).toMatchObject({ ok: false, message: "这条速记已经不在了" });
  });
});

describe("convertCaptureToStudentRecord", () => {
  // capture-inbox.tsx 用 data.set 拼的就是这三个键
  const toStudent = () => form([["classGroupId", "class-1"], ["typeId", "type-1"], ["studentId", "s1"]]);

  beforeEach(() => {
    mocks.classGroupFindUnique.mockResolvedValue({ id: "class-1" });
    mocks.studentRecordTypeFindUnique.mockResolvedValue({ id: "type-1" });
    mocks.studentFindUnique.mockResolvedValue({ classGroupId: "class-1" });
  });

  it("标题和正文合成记录内容，挂到那名学生名下", async () => {
    const state = await convertCaptureToStudentRecord("c1", toStudent());
    expect(state.message).toBe("已归到学生记录");
    expect(mocks.tx.studentRecord.create.mock.calls[0][0].data).toMatchObject({
      classGroupId: "class-1",
      typeId: "type-1",
      content: "催恒新公司出具首期验收意见\n周五前",
      members: { create: [{ studentId: "s1" }] },
    });
  });

  /** 归属拿库里的值复核，不信表单 */
  it("学生不在这个班里就拒绝，不进事务", async () => {
    mocks.studentFindUnique.mockResolvedValue({ classGroupId: "class-2" });
    const state = await convertCaptureToStudentRecord("c1", toStudent());
    expect(state).toMatchObject({ ok: false, message: "学生不在这个班里，刷新后重试" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("并发里认领落空就不建学生记录", async () => {
    mocks.tx.captureItem.updateMany.mockResolvedValue({ count: 0 });
    const state = await convertCaptureToStudentRecord("c1", toStudent());
    expect(state.message).toBe("这条已经转过了");
    expect(mocks.tx.studentRecord.create).not.toHaveBeenCalled();
  });
});

describe("convertCaptureToMenteeRecord", () => {
  const toMentee = () => form([["batchId", "batch-1"], ["typeId", "type-1"], ["menteeId", "m1"]]);

  beforeEach(() => {
    mocks.batchFindUnique.mockResolvedValue({ id: "batch-1" });
    mocks.menteeRecordTypeFindUnique.mockResolvedValue({ id: "type-1" });
    mocks.menteeFindUnique.mockResolvedValue({ batchId: "batch-1" });
  });

  it("归到那名导师学生名下，指针指向新记录", async () => {
    const state = await convertCaptureToMenteeRecord("c1", toMentee());
    expect(state.message).toBe("已归到指导记录");
    expect(mocks.tx.menteeRecord.create.mock.calls[0][0].data).toMatchObject({
      batchId: "batch-1",
      members: { create: [{ menteeId: "m1" }] },
    });
    expect(mocks.tx.captureItem.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { convertedMenteeRecordId: "mrec-1" },
    });
  });

  it("学生不在这一批就拒绝", async () => {
    mocks.menteeFindUnique.mockResolvedValue({ batchId: "batch-2" });
    const state = await convertCaptureToMenteeRecord("c1", toMentee());
    expect(state).toMatchObject({ ok: false, message: "这名学生不在这一批里，刷新后重试" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("并发里认领落空就不建指导记录", async () => {
    mocks.tx.captureItem.updateMany.mockResolvedValue({ count: 0 });
    const state = await convertCaptureToMenteeRecord("c1", toMentee());
    expect(state.message).toBe("这条已经转过了");
    expect(mocks.tx.menteeRecord.create).not.toHaveBeenCalled();
  });
});
