import { describe, expect, it } from "vitest";
import {
  beginDocumentDelete,
  deleteNoticeFromState,
  shouldResetUploadForm,
} from "./document-library-state";
import type { FormState } from "./form-state";

describe("shouldResetUploadForm", () => {
  it("does not reset when props change or a failed result arrives", () => {
    const failed: FormState = { ok: false, message: "请选择要上传的文件" };

    expect(shouldResetUploadForm(undefined, failed)).toBe(false);
    expect(shouldResetUploadForm(failed, failed)).toBe(false);
  });

  it("resets once for each distinct successful action result", () => {
    const first: FormState = { ok: true, message: "已上传 课程标准.docx" };
    const second: FormState = { ok: true, message: "已上传 课程标准.docx" };

    expect(shouldResetUploadForm(undefined, first)).toBe(true);
    expect(shouldResetUploadForm(first, first)).toBe(false);
    expect(shouldResetUploadForm(first, second)).toBe(true);
  });
});

describe("deleteNoticeFromState", () => {
  it("retains warning cleanup feedback independently from the removed table row", () => {
    const notice = deleteNoticeFromState({
      ok: true,
      tone: "warning",
      message: "记录已删除，文件清理待处理",
    });

    expect(notice).toEqual({
      tone: "warning",
      message: "记录已删除，文件清理待处理",
    });
  });

  it("uses success for normal deletion and error for failures", () => {
    expect(deleteNoticeFromState({ ok: true, message: "已删除 课程标准.pdf" })).toEqual({
      tone: "success",
      message: "已删除 课程标准.pdf",
    });
    expect(deleteNoticeFromState({ ok: false, message: "个人常用文档不存在" })).toEqual({
      tone: "error",
      message: "个人常用文档不存在",
    });
  });
});

describe("beginDocumentDelete", () => {
  it("rejects both a repeated click and a second row while a deletion is pending", () => {
    const started = beginDocumentDelete(null, "attachment-a");

    expect(started).toEqual({ started: true, pendingDeleteId: "attachment-a" });
    expect(beginDocumentDelete(started.pendingDeleteId, "attachment-a")).toEqual({
      started: false,
      pendingDeleteId: "attachment-a",
    });
    expect(beginDocumentDelete(started.pendingDeleteId, "attachment-b")).toEqual({
      started: false,
      pendingDeleteId: "attachment-a",
    });
  });
});
