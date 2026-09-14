import { describe, expect, it } from "vitest";
import {
  attachmentDownloadHref,
  groupPersonalDocumentsByCategory,
  resolveProfileTab,
} from "./personal-documents";

describe("resolveProfileTab", () => {
  it("defaults unknown and repeated query values to basic information", () => {
    expect(resolveProfileTab(undefined)).toBe("profile");
    expect(resolveProfileTab("documents")).toBe("documents");
    expect(resolveProfileTab("unexpected")).toBe("profile");
    expect(resolveProfileTab(["documents", "profile"])).toBe("profile");
  });
});

describe("groupPersonalDocumentsByCategory", () => {
  const categories = [
    { id: "reference", name: "申报参考", sortOrder: 20 },
    { id: "course", name: "课程标准", sortOrder: 10 },
    { id: "empty", name: "空分类", sortOrder: 30 },
  ];

  it("keeps only non-empty categories and orders each group by latest upload", () => {
    const grouped = groupPersonalDocumentsByCategory(categories, [
      { id: "old", docCategoryId: "course", uploadedAt: new Date("2026-07-01T00:00:00Z") },
      { id: "new", docCategoryId: "course", uploadedAt: new Date("2026-07-02T00:00:00Z") },
      { id: "ref", docCategoryId: "reference", uploadedAt: new Date("2026-07-03T00:00:00Z") },
    ]);

    expect(grouped.map((group) => group.category.name)).toEqual(["课程标准", "申报参考"]);
    expect(grouped[0].items.map((item) => item.id)).toEqual(["new", "old"]);
  });
});

describe("attachmentDownloadHref", () => {
  it("uses only the attachment id in the download URL", () => {
    expect(attachmentDownloadHref("attachment_123", "人才培养方案 2026.docx")).toBe(
      "/api/attachments/attachment_123?download=1",
    );
  });
});
