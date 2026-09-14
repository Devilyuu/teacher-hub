import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  achievementFindMany: vi.fn(),
  achievementFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    achievement: {
      findMany: mocks.achievementFindMany,
      findUnique: mocks.achievementFindUnique,
    },
  },
}));

import {
  getAchievementDetail,
  getAchievementList,
  getAllLinkCandidates,
} from "@/lib/queries/achievements";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.achievementFindMany.mockResolvedValue([]);
  mocks.achievementFindUnique.mockResolvedValue(null);
});

describe("archived achievement query boundaries", () => {
  it("only lists active achievements", async () => {
    await getAchievementList();
    expect(mocks.achievementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });

  it("only offers active achievements as requirement-link candidates", async () => {
    await getAllLinkCandidates();
    expect(mocks.achievementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });

  it("reads the legacy project target only for canonical redirects", async () => {
    await getAchievementDetail("legacy-a1");
    expect(mocks.achievementFindUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "legacy-a1", archivedAt: null },
      }),
    );
    expect(mocks.achievementFindUnique).toHaveBeenNthCalledWith(2, {
      where: { id: "legacy-a1" },
      select: {
        id: true,
        archivedAt: true,
        legacyProjectPerformance: { select: { projectId: true } },
      },
    });
  });
});
