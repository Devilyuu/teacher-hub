import { describe, expect, it } from "vitest";
import {
  docCategoryCreateSchema,
  personalDocumentUploadSchema,
} from "./personal-document";

describe("personalDocumentUploadSchema", () => {
  it("清理分类编号与备注，空备注存为 null", () => {
    expect(
      personalDocumentUploadSchema.parse({
        categoryId: "  category-1  ",
        note: "   ",
      }),
    ).toEqual({ categoryId: "category-1", note: null });

    expect(
      personalDocumentUploadSchema.parse({
        categoryId: "category-1",
        note: "  2026 版  ",
      }),
    ).toEqual({ categoryId: "category-1", note: "2026 版" });
  });

  it("拒绝空分类编号", () => {
    const result = personalDocumentUploadSchema.safeParse({ categoryId: "  ", note: "" });

    expect(result.success).toBe(false);
  });
});

describe("docCategoryCreateSchema", () => {
  it("在服务端 trim 名称", () => {
    expect(docCategoryCreateSchema.parse({ name: "  教学参考  " })).toEqual({
      name: "教学参考",
    });
  });

  it("拒绝全空白名称", () => {
    const result = docCategoryCreateSchema.safeParse({ name: "   " });

    expect(result.success).toBe(false);
  });

  it("拒绝超过 50 个字符的名称", () => {
    const result = docCategoryCreateSchema.safeParse({ name: "类".repeat(51) });

    expect(result.success).toBe(false);
  });
});
