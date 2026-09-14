import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profileFindFirst: vi.fn(),
  categoryFindMany: vi.fn(),
  attachmentFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    profile: { findFirst: mocks.profileFindFirst },
    docCategory: { findMany: mocks.categoryFindMany },
    attachment: { findMany: mocks.attachmentFindMany },
  },
}));

import { loadProfilePageData } from "@/app/(app)/profile/profile-page-data";

describe("loadProfilePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileFindFirst.mockResolvedValue({ id: "profile" });
    mocks.categoryFindMany.mockResolvedValue([]);
    mocks.attachmentFindMany.mockResolvedValue([]);
  });

  it("loads only the profile for the basic-information tab", async () => {
    await loadProfilePageData("profile");

    expect(mocks.profileFindFirst).toHaveBeenCalledOnce();
    expect(mocks.categoryFindMany).not.toHaveBeenCalled();
    expect(mocks.attachmentFindMany).not.toHaveBeenCalled();
  });

  it("loads minimal personal-document fields only for the documents tab", async () => {
    await loadProfilePageData("documents");

    expect(mocks.profileFindFirst).not.toHaveBeenCalled();
    expect(mocks.categoryFindMany).toHaveBeenCalledWith({
      select: { id: true, name: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    expect(mocks.attachmentFindMany).toHaveBeenCalledWith({
      where: { docCategoryId: { not: null }, projectId: null, achievementId: null },
      select: {
        id: true,
        docCategoryId: true,
        filename: true,
        size: true,
        note: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: "desc" },
    });
  });
});
