import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  achievementFindUnique: vi.fn(),
  achievementDelete: vi.fn(),
  requirementLinkCount: vi.fn(),
  activityCreate: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(() => {
    // 真实的 redirect 会抛，动作里靠它结束——mock 必须照做，
    // 否则测试会继续往下跑，看不出「成功路径到此为止」
    throw new Error("NEXT_REDIRECT");
  }),
  deleteUpload: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/storage", () => ({ deleteUpload: mocks.deleteUpload }));
vi.mock("@/lib/db", () => ({
  prisma: {
    achievement: {
      findUnique: mocks.achievementFindUnique,
      delete: mocks.achievementDelete,
    },
    requirementLink: { count: mocks.requirementLinkCount },
    activityLog: { create: mocks.activityCreate },
  },
}));

import { deleteAchievement } from "@/app/(app)/achievements/actions";

const IDLE = { ok: false as const, message: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirementLinkCount.mockResolvedValue(0);
  mocks.achievementFindUnique.mockResolvedValue({
    title: "测试成果",
    archivedAt: null,
    attachments: [],
  });
});

describe("deleteAchievement", () => {
  it("先验会话", async () => {
    mocks.achievementFindUnique.mockResolvedValue(null);
    await deleteAchievement("a-1", IDLE, new FormData());
    expect(mocks.requireSession).toHaveBeenCalled();
  });

  it("成果不存在时给话，不抛错", async () => {
    mocks.achievementFindUnique.mockResolvedValue(null);
    const state = await deleteAchievement("a-1", IDLE, new FormData());
    expect(state).toEqual({ ok: false, message: "成果不存在或已删除" });
    expect(mocks.achievementDelete).not.toHaveBeenCalled();
  });

  /**
   * 归档副本是 2.7 历史迁移的产物，详情页会重定向到规范课题。
   * 在界面上顺手删掉它等于抹掉审计关系（CLAUDE.md 二期 2.7 口径第 7 条）。
   */
  it("拒绝删除已归档的历史副本", async () => {
    mocks.achievementFindUnique.mockResolvedValue({
      title: "历史副本",
      archivedAt: new Date("2026-07-30"),
      attachments: [],
    });
    const state = await deleteAchievement("a-1", IDLE, new FormData());
    expect(state.ok).toBe(false);
    expect(mocks.achievementDelete).not.toHaveBeenCalled();
  });

  /**
   * 系统只计算不判定：有已确认达标的挂接时不代替用户决定，
   * 也不偷偷把挂接一起删掉，只说清楚该先做什么。
   */
  it("还有已确认达标的挂接时拒绝，并说明有几条", async () => {
    mocks.requirementLinkCount.mockResolvedValue(2);
    const state = await deleteAchievement("a-1", IDLE, new FormData());
    expect(state.ok).toBe(false);
    expect(state.message).toContain("2 条");
    expect(mocks.achievementDelete).not.toHaveBeenCalled();
  });

  it("未确认达标的挂接不阻止删除", async () => {
    mocks.requirementLinkCount.mockResolvedValue(0);
    await expect(deleteAchievement("a-1", IDLE, new FormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.achievementDelete).toHaveBeenCalledWith({ where: { id: "a-1" } });
  });

  /**
   * 附件记录会被外键级联删掉，**磁盘文件不会**——不显式清盘的话
   * data/uploads 里会永远留着一堆没人引用的文件。
   */
  it("连带删除磁盘上的支撑材料，且在删库之后", async () => {
    mocks.achievementFindUnique.mockResolvedValue({
      title: "带材料的成果",
      archivedAt: null,
      attachments: [{ storagePath: "achievements/a-1/x.pdf" }, { storagePath: "achievements/a-1/y.png" }],
    });

    await expect(deleteAchievement("a-1", IDLE, new FormData())).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.deleteUpload.mock.calls.map(([path]) => path)).toEqual([
      "achievements/a-1/x.pdf",
      "achievements/a-1/y.png",
    ]);
    // 顺序：先删库再删盘。反过来会留下指向空文件的记录
    expect(mocks.achievementDelete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUpload.mock.invocationCallOrder[0],
    );
  });

  it("拒绝时不碰磁盘", async () => {
    mocks.requirementLinkCount.mockResolvedValue(1);
    await deleteAchievement("a-1", IDLE, new FormData());
    expect(mocks.deleteUpload).not.toHaveBeenCalled();
  });
});
