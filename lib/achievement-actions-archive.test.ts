import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  transaction: vi.fn(),
  achievementFindUnique: vi.fn(),
  achievementUpdateMany: vi.fn(),
  activityCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  quickEditAchievement,
  updateAchievement,
} from "@/app/(app)/achievements/actions";

const fullForm = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
      type: "PAPER",
      title: "测试成果",
      status: "PUBLISHED",
      authorPosition: "",
      ownerRole: "",
      level: "PROVINCIAL",
      journalName: "",
      journalLevel: "",
      indexedBy: "",
      wordCount: "",
      completedAt: "",
      publishedAt: "",
      dateText: "",
      datePrecision: "UNKNOWN",
      tags: "",
      evidenceRef: "",
      obsidianPath: "",
      externalRef: "",
      promotionCategoryId: "",
      perfCategoryId: "",
      promotionScore: "",
      declaredScore: "",
      isVerified: "on",
      note: "",
    })) {
    form.set(key, value);
  }
  return form;
};

function transactionClient() {
  return {
    achievement: {
      findUnique: mocks.achievementFindUnique,
      updateMany: mocks.achievementUpdateMany,
    },
    activityLog: { create: mocks.activityCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
      callback(transactionClient()),
  );
});

describe("achievement archive write boundary", () => {
  it("refuses a full edit of an archived legacy duplicate before any update", async () => {
    mocks.achievementFindUnique.mockResolvedValue({
      status: "PUBLISHED",
      archivedAt: new Date("2026-07-30T00:00:00.000Z"),
    });

    const result = await updateAchievement("legacy-a1", { ok: false }, fullForm());

    expect(result).toEqual({
      ok: false,
      message: "该成果已归档并合并到课题，不能再修改",
    });
    expect(mocks.achievementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("re-reads archive state when a guarded quick edit updates zero rows", async () => {
    mocks.achievementFindUnique
      .mockResolvedValueOnce({ status: "PUBLISHED", archivedAt: null })
      .mockResolvedValueOnce({
        status: "PUBLISHED",
        archivedAt: new Date("2026-07-30T00:00:00.000Z"),
      });
    mocks.achievementUpdateMany.mockResolvedValue({ count: 0 });
    const form = new FormData();
    form.set("type", "PAPER");
    form.set("status", "PUBLISHED");
    form.set("level", "PROVINCIAL");
    form.set("year", "2026");
    form.set("perfCategoryId", "");
    form.set("promotionCategoryId", "");
    form.set("promotionScore", "");
    form.set("declaredScore", "");
    form.set("isVerified", "on");

    const result = await quickEditAchievement("legacy-a1", { ok: false }, form);

    expect(mocks.achievementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "legacy-a1", archivedAt: null } }),
    );
    expect(result).toEqual({
      ok: false,
      message: "该成果已归档并合并到课题，不能再修改",
    });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });
});
