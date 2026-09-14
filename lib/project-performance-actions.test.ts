import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectFindUnique = vi.fn();
  const perfCategoryFindFirst = vi.fn();
  const eventCreate = vi.fn();
  const eventFindUnique = vi.fn();
  const eventDeleteMany = vi.fn();
  const tx = {
    project: { findUnique: projectFindUnique },
    perfCategory: { findFirst: perfCategoryFindFirst },
    projectPerformanceEvent: {
      create: eventCreate,
      findUnique: eventFindUnique,
      deleteMany: eventDeleteMany,
    },
  };

  return {
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    logActivity: vi.fn(),
    transaction: vi.fn(),
    projectFindUnique,
    perfCategoryFindFirst,
    eventCreate,
    eventFindUnique,
    eventDeleteMany,
    tx,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  createProjectPerformanceEvent,
  deleteProjectPerformanceEvent,
} from "@/app/(app)/projects/[id]/project-performance-actions";
import { PROJECT_PERF_MINORS } from "@/lib/project-performance";

const sourceProject = {
  title: "生成式人工智能赋能制造业研究",
  shortTitle: "中小企业品牌传播",
  level: "MUNICIPAL",
  role: "LEAD",
  fundingType: "VERTICAL",
  status: "ONGOING",
  applyDeadline: new Date("2025-10-01T00:00:00.000Z"),
  startDate: new Date("2026-01-10T00:00:00.000Z"),
  endDate: new Date("2027-12-31T00:00:00.000Z"),
  closingDeadline: new Date("2028-01-31T00:00:00.000Z"),
  fundingReceived: null,
  dateText: null,
};

const nativeEvent = {
  id: "event-1",
  projectId: "project-1",
  legacyAchievementId: null,
  kind: "APPROVED",
  year: 2026,
};

const migratedEvent = {
  ...nativeEvent,
  legacyAchievementId: "achievement-1",
};

function createForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields = {
    kind: "APPROVED",
    year: "2026",
    perfCategoryId: "perf-1",
    declaredScore: "18",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

function deleteForm(id = "event-1") {
  const form = new FormData();
  form.set("id", id);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  );
  mocks.projectFindUnique.mockResolvedValue(sourceProject);
  mocks.perfCategoryFindFirst.mockImplementation(
    async (args: { orderBy?: { year: string } }) =>
      args.orderBy ? { year: 2026 } : { id: "perf-1" },
  );
  mocks.eventCreate.mockResolvedValue({ id: "event-1" });
  mocks.eventFindUnique.mockResolvedValue(nativeEvent);
  mocks.eventDeleteMany.mockResolvedValue({ count: 1 });
  mocks.logActivity.mockResolvedValue(undefined);
});

describe("createProjectPerformanceEvent", () => {
  it("authenticates even when form data is invalid", async () => {
    const result = await createProjectPerformanceEvent(
      "project-1",
      { ok: false },
      createForm({ year: "不详" }),
    );

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("validates the trusted project and current candidate category inside one transaction", async () => {
    const result = await createProjectPerformanceEvent(
      "project-1",
      { ok: false },
      createForm(),
    );

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1" } }),
    );
    expect(mocks.perfCategoryFindFirst).toHaveBeenNthCalledWith(1, {
      orderBy: { year: "desc" },
      select: { year: true },
    });
    expect(mocks.perfCategoryFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        id: "perf-1",
        year: 2026,
        isActive: true,
        minorCategory: { in: [...PROJECT_PERF_MINORS] },
      },
      select: { id: true },
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        kind: "APPROVED",
        year: 2026,
        perfCategoryId: "perf-1",
        declaredScore: 18,
        isVerified: false,
        note: "课题绩效事项：立项",
      },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "ProjectPerformanceEvent",
      "event-1",
      "新增课题绩效事项",
      expect.objectContaining({ projectId: "project-1", kind: "APPROVED" }),
      mocks.tx,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project-1",
      "/achievements",
      "/export",
    ]);
    expect(result).toMatchObject({ ok: true });
  });

  it("returns a clear error when the project is missing", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(null);

    await expect(
      createProjectPerformanceEvent("project-1", { ok: false }, createForm()),
    ).resolves.toMatchObject({ ok: false, message: "课题不存在" });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a clear error when no current performance rules exist", async () => {
    mocks.perfCategoryFindFirst.mockResolvedValueOnce(null);

    await expect(
      createProjectPerformanceEvent("project-1", { ok: false }, createForm()),
    ).resolves.toMatchObject({ ok: false, message: "当前没有可用的绩效分类" });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["非候选小类", "perf-paper"],
    ["已停用分类", "perf-inactive"],
    ["旧年度分类", "perf-old"],
    ["伪造编号", "perf-forged"],
  ])("rejects %s without creating or logging", async (_case, perfCategoryId) => {
    mocks.perfCategoryFindFirst
      .mockResolvedValueOnce({ year: 2026 })
      .mockResolvedValueOnce(null);

    const result = await createProjectPerformanceEvent(
      "project-1",
      { ok: false },
      createForm({ perfCategoryId }),
    );

    expect(result).toEqual({
      ok: false,
      message: "绩效分类不存在或不在当前可用候选中",
    });
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure and does not revalidate when activity logging fails", async () => {
    mocks.logActivity.mockRejectedValueOnce(new Error("database secret"));

    await expect(
      createProjectPerformanceEvent("project-1", { ok: false }, createForm()),
    ).resolves.toEqual({
      ok: false,
      message: "课题绩效事项保存失败，请稍后重试",
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.eventCreate).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteProjectPerformanceEvent", () => {
  it("authenticates and validates the event id before opening a transaction", async () => {
    const result = await deleteProjectPerformanceEvent({ ok: false }, deleteForm(""));

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns a clear error for a missing event", async () => {
    mocks.eventFindUnique.mockResolvedValueOnce(null);

    await expect(
      deleteProjectPerformanceEvent({ ok: false }, deleteForm()),
    ).resolves.toMatchObject({ ok: false, message: "课题绩效事项不存在" });
    expect(mocks.eventDeleteMany).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("refuses to delete a migrated event", async () => {
    mocks.eventFindUnique.mockResolvedValueOnce(migratedEvent);

    await expect(
      deleteProjectPerformanceEvent({ ok: false }, deleteForm()),
    ).resolves.toEqual({
      ok: false,
      message: "迁移形成的绩效事项需在迁移核对工具中处理",
    });
    expect(mocks.eventDeleteMany).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("conditionally deletes a native event and logs within the transaction", async () => {
    const result = await deleteProjectPerformanceEvent({ ok: false }, deleteForm());

    expect(mocks.eventDeleteMany).toHaveBeenCalledWith({
      where: { id: "event-1", legacyAchievementId: null },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "ProjectPerformanceEvent",
      "event-1",
      "删除课题绩效事项",
      { projectId: "project-1", kind: "APPROVED", year: 2026 },
      mocks.tx,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project-1",
      "/achievements",
      "/export",
    ]);
    expect(result).toMatchObject({ ok: true });
  });

  it("does not log when a concurrent migration makes the conditional delete miss", async () => {
    mocks.eventDeleteMany.mockResolvedValueOnce({ count: 0 });
    mocks.eventFindUnique
      .mockResolvedValueOnce(nativeEvent)
      .mockResolvedValueOnce(migratedEvent);

    await expect(
      deleteProjectPerformanceEvent({ ok: false }, deleteForm()),
    ).resolves.toEqual({
      ok: false,
      message: "迁移形成的绩效事项需在迁移核对工具中处理",
    });
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not log when a concurrent delete makes the conditional delete miss", async () => {
    mocks.eventDeleteMany.mockResolvedValueOnce({ count: 0 });
    mocks.eventFindUnique.mockResolvedValueOnce(nativeEvent).mockResolvedValueOnce(null);

    await expect(
      deleteProjectPerformanceEvent({ ok: false }, deleteForm()),
    ).resolves.toEqual({
      ok: false,
      message: "课题绩效事项不存在",
    });
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure and does not revalidate when activity logging fails", async () => {
    mocks.logActivity.mockRejectedValueOnce(new Error("database secret"));

    await expect(
      deleteProjectPerformanceEvent({ ok: false }, deleteForm()),
    ).resolves.toEqual({
      ok: false,
      message: "课题绩效事项删除失败，请稍后重试",
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.eventDeleteMany).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
