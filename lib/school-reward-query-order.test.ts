import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  achievementFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: mocks.projectFindUnique },
    achievement: { findUnique: mocks.achievementFindUnique },
  },
}));

import { getAchievementDetail } from "@/lib/queries/achievements";
import { getProjectDetail } from "@/lib/queries/projects";

const deterministicRewardOrder = [
  { approvedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectFindUnique.mockResolvedValue(null);
  mocks.achievementFindUnique.mockResolvedValue(null);
});

describe("school reward detail ordering", () => {
  it("uses approval date, creation time and id for deterministic project detail rows", async () => {
    await getProjectDetail("project-1");

    expect(mocks.projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          schoolRewards: { orderBy: deterministicRewardOrder },
        }),
      }),
    );
  });

  it("uses the same deterministic order for achievement detail rows", async () => {
    await getAchievementDetail("achievement-1");

    expect(mocks.achievementFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          schoolRewards: { orderBy: deterministicRewardOrder },
        }),
      }),
    );
  });
});
