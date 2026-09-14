import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectFindUnique = vi.fn();
  const achievementFindUnique = vi.fn();
  const rewardCreate = vi.fn();
  const rewardFindUnique = vi.fn();
  const rewardDelete = vi.fn();
  const tx = {
    project: { findUnique: projectFindUnique },
    achievement: { findUnique: achievementFindUnique },
    schoolRewardDecision: {
      create: rewardCreate,
      findUnique: rewardFindUnique,
      delete: rewardDelete,
    },
  };

  return {
    requireSession: vi.fn(),
    revalidatePath: vi.fn(),
    logActivity: vi.fn(),
    transaction: vi.fn(),
    projectFindUnique,
    achievementFindUnique,
    rewardCreate,
    rewardFindUnique,
    rewardDelete,
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
  createSchoolRewardDecision,
  deleteSchoolRewardDecision,
} from "@/app/(app)/school-reward-actions";

const savedReward = {
  id: "reward-1",
  projectId: "project-1",
  achievementId: null,
  approvedAt: new Date("2026-07-30T00:00:00.000Z"),
  batch: "2026 年第一批",
  domain: "RESEARCH",
  awardItem: "市级社科课题优秀成果",
  awardLevel: "一等奖",
  awardAmountYuan: { toString: () => "3000.50" },
  evidenceRef: "常机电〔2026〕18号",
  note: "学校会议审定通过",
  createdAt: new Date("2026-07-31T02:00:00.000Z"),
  updatedAt: new Date("2026-07-31T02:00:00.000Z"),
};

function createForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const fields = {
    approvedAt: "2026-07-30",
    batch: "2026 年第一批",
    domain: "RESEARCH",
    awardItem: "市级社科课题优秀成果",
    awardLevel: "一等奖",
    awardAmountYuan: "3000.50",
    evidenceRef: "常机电〔2026〕18号",
    note: "学校会议审定通过",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx),
  );
  mocks.projectFindUnique.mockResolvedValue({ id: "project-1" });
  mocks.achievementFindUnique.mockResolvedValue({ id: "achievement-1" });
  mocks.rewardCreate.mockResolvedValue({ id: "reward-1" });
  mocks.rewardFindUnique.mockResolvedValue(savedReward);
  mocks.rewardDelete.mockResolvedValue(savedReward);
  mocks.logActivity.mockResolvedValue(undefined);
});

describe("createSchoolRewardDecision", () => {
  it("authenticates before returning validation errors", async () => {
    const result = await createSchoolRewardDecision(
      { kind: "PROJECT", id: "project-1" },
      { ok: false },
      createForm({ awardItem: "" }),
    );

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("validates the bound project, creates exactly one target and audits in one transaction", async () => {
    const result = await createSchoolRewardDecision(
      { kind: "PROJECT", id: "project-1" },
      { ok: false },
      createForm(),
    );

    expect(mocks.projectFindUnique).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: { id: true },
    });
    expect(mocks.achievementFindUnique).not.toHaveBeenCalled();
    expect(mocks.rewardCreate).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        achievementId: null,
        approvedAt: new Date("2026-07-30T00:00:00.000Z"),
        batch: "2026 年第一批",
        domain: "RESEARCH",
        awardItem: "市级社科课题优秀成果",
        awardLevel: "一等奖",
        awardAmountYuan: 3000.5,
        evidenceRef: "常机电〔2026〕18号",
        note: "学校会议审定通过",
      },
      select: { id: true },
    });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "SchoolRewardDecision",
      "reward-1",
      "记录学校突出成果审定通过",
      expect.objectContaining({
        targetKind: "PROJECT",
        targetId: "project-1",
        awardItem: "市级社科课题优秀成果",
      }),
      mocks.tx,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project-1",
      "/projects",
      "/achievements",
      "/export",
    ]);
    expect(result).toEqual({ ok: true, message: "已记录学校审定通过" });
  });

  it("binds an achievement without accepting a second target from form data", async () => {
    const form = createForm();
    form.set("projectId", "forged-project");

    await createSchoolRewardDecision(
      { kind: "ACHIEVEMENT", id: "achievement-1" },
      { ok: false },
      form,
    );

    expect(mocks.achievementFindUnique).toHaveBeenCalledWith({
      where: { id: "achievement-1" },
      select: { id: true },
    });
    expect(mocks.rewardCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: null,
          achievementId: "achievement-1",
        }),
      }),
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/achievements/achievement-1",
      "/projects",
      "/achievements",
      "/export",
    ]);
  });

  it("returns a clear failure when the bound target no longer exists", async () => {
    mocks.projectFindUnique.mockResolvedValueOnce(null);

    const result = await createSchoolRewardDecision(
      { kind: "PROJECT", id: "project-1" },
      { ok: false },
      createForm(),
    );

    expect(result).toEqual({ ok: false, message: "课题不存在" });
    expect(mocks.rewardCreate).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure and does not revalidate if the transaction fails", async () => {
    mocks.logActivity.mockRejectedValueOnce(new Error("database secret"));

    const result = await createSchoolRewardDecision(
      { kind: "PROJECT", id: "project-1" },
      { ok: false },
      createForm(),
    );

    expect(result).toEqual({
      ok: false,
      message: "学校奖励审定记录保存失败，请稍后重试",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteSchoolRewardDecision", () => {
  it("authenticates before reading the decision", async () => {
    await deleteSchoolRewardDecision("reward-1");

    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.rewardFindUnique).toHaveBeenCalledWith({ where: { id: "reward-1" } });
  });

  it("records every deleted field in the transaction audit and revalidates the original target", async () => {
    const result = await deleteSchoolRewardDecision("reward-1");

    expect(mocks.rewardDelete).toHaveBeenCalledWith({ where: { id: "reward-1" } });
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "SchoolRewardDecision",
      "reward-1",
      "删除误录的学校突出成果审定",
      {
        projectId: "project-1",
        achievementId: null,
        approvedAt: "2026-07-30",
        batch: "2026 年第一批",
        domain: "RESEARCH",
        awardItem: "市级社科课题优秀成果",
        awardLevel: "一等奖",
        awardAmountYuan: "3000.50",
        evidenceRef: "常机电〔2026〕18号",
        note: "学校会议审定通过",
        createdAt: "2026-07-31T02:00:00.000Z",
        updatedAt: "2026-07-31T02:00:00.000Z",
      },
      mocks.tx,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project-1",
      "/projects",
      "/achievements",
      "/export",
    ]);
    expect(result).toEqual({ ok: true, message: "误录的学校审定记录已删除" });
  });

  it("returns a clear failure for a missing decision", async () => {
    mocks.rewardFindUnique.mockResolvedValueOnce(null);

    const result = await deleteSchoolRewardDecision("missing");

    expect(result).toEqual({ ok: false, message: "学校奖励审定记录不存在" });
    expect(mocks.rewardDelete).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a sanitized failure and does not revalidate if deletion or audit fails", async () => {
    mocks.logActivity.mockRejectedValueOnce(new Error("database secret"));

    const result = await deleteSchoolRewardDecision("reward-1");

    expect(result).toEqual({
      ok: false,
      message: "学校奖励审定记录删除失败，请稍后重试",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
