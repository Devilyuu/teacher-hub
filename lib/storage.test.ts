import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  canPreviewInline,
  isAllowedUpload,
  personalScope,
  isSameOrAncestorPath,
  projectScope,
  resolveStoragePath,
  resolveUploadRoot,
  saveUpload,
  UPLOAD_ROOT,
} from "./storage";

const TEST_UPLOAD_ROOT = resolve(process.cwd(), "test/.tmp-uploads");

afterAll(async () => {
  await rm(TEST_UPLOAD_ROOT, { recursive: true, force: true });
});

describe("resolveUploadRoot", () => {
  it("validates and returns the lexical default for missing and ordinary directories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "teacher-desk-default-root-"));
    const expected = join(workspace, "data", "uploads");
    try {
      expect(resolveUploadRoot(undefined, workspace)).toBe(expected);
      await mkdir(expected, { recursive: true });
      expect(resolveUploadRoot(undefined, workspace)).toBe(expected);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects a default upload root that links to the workspace or its ancestor", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "teacher-desk-default-link-"));
    const data = join(workspace, "data");
    const uploadRoot = join(data, "uploads");
    await mkdir(data);
    try {
      for (const target of [workspace, dirname(workspace)]) {
        await symlink(target, uploadRoot, process.platform === "win32" ? "junction" : "dir");
        expect(() => resolveUploadRoot(undefined, workspace)).toThrow();
        await rm(uploadRoot, { force: true });
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects an ordinary file at the default upload root", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "teacher-desk-default-file-"));
    const uploadRoot = join(workspace, "data", "uploads");
    try {
      await mkdir(dirname(uploadRoot), { recursive: true });
      await writeFile(uploadRoot, "not a directory", "utf8");
      expect(() => resolveUploadRoot(undefined, workspace)).toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("accepts an absolute, isolated override", () => {
    const root = resolve(process.cwd(), "test/.tmp-e2e-uploads");
    expect(resolveUploadRoot(root)).toBe(root);
  });

  it("rejects unsafe overrides", () => {
    const workspace = process.cwd();
    expect(() => resolveUploadRoot("   ")).toThrow();
    expect(() => resolveUploadRoot("data/uploads")).toThrow();
    expect(() => resolveUploadRoot(workspace)).toThrow();
    expect(() => resolveUploadRoot(resolve(workspace, ".."))).toThrow();
    expect(() => resolveUploadRoot(process.platform === "win32" ? "C:\\" : "/")).toThrow();
  });

  it("rejects NUL-containing overrides", () => {
    expect(() => resolveUploadRoot(`${resolve(process.cwd(), "tmp")}\0evil`)).toThrow();
  });

  it("canonicalizes a missing tail from its nearest existing ancestor", async () => {
    const parent = await mkdtemp(join(tmpdir(), "teacher-desk-storage-parent-"));
    try {
      const root = join(parent, "missing", "uploads");
      expect(resolveUploadRoot(root)).toBe(root);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects a symlink or junction that resolves to the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "teacher-desk-storage-link-"));
    const link = join(parent, "workspace-link");
    try {
      await symlink(process.cwd(), link, process.platform === "win32" ? "junction" : "dir");
      expect(() => resolveUploadRoot(join(link, "uploads"))).toThrow(/workspace|工作区/i);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("fails closed when the nearest existing ancestor is a dangling link", async () => {
    const parent = await mkdtemp(join(tmpdir(), "teacher-desk-storage-dangling-"));
    const target = join(parent, "missing-target");
    const link = join(parent, "dangling-link");
    try {
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
      expect(() => resolveUploadRoot(join(link, "uploads"))).toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects an existing file as the upload root or nearest ancestor", async () => {
    const parent = await mkdtemp(join(tmpdir(), "teacher-desk-storage-file-"));
    const file = join(parent, "ordinary-file");
    try {
      await writeFile(file, "not a directory", "utf8");
      expect(() => resolveUploadRoot(file)).toThrow();
      expect(() => resolveUploadRoot(join(file, "uploads"))).toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("cross-platform path comparisons", () => {
  it("treats Windows drive letters and extended drive paths case-insensitively", () => {
    expect(isSameOrAncestorPath("C:\\Work", "c:\\work\\uploads", "win32")).toBe(true);
    expect(isSameOrAncestorPath("C:\\Work", "\\\\?\\C:\\WORK\\uploads", "win32")).toBe(true);
  });

  it("normalizes extended UNC paths without crossing share boundaries", () => {
    expect(
      isSameOrAncestorPath(
        "\\\\server\\share\\work",
        "\\\\?\\UNC\\SERVER\\SHARE\\work\\uploads",
        "win32",
      ),
    ).toBe(true);
    expect(
      isSameOrAncestorPath("\\\\server\\share\\work", "\\\\server\\share2\\work", "win32"),
    ).toBe(false);
  });
});

describe("resolveStoragePath 显式根目录", () => {
  it("允许测试或其他运行时注入隔离的存储根目录", () => {
    const isolatedRoot = resolve(process.cwd(), "test/.tmp-isolated-uploads");
    expect(resolveStoragePath("projects/abc/file.pdf", isolatedRoot)).toBe(
      resolve(isolatedRoot, "projects/abc/file.pdf"),
    );
  });
});

describe("resolveStoragePath · 路径穿越", () => {
  it("正常相对路径落在上传根目录下", () => {
    const absolute = resolveStoragePath("projects/abc/file.pdf");
    expect(absolute.startsWith(UPLOAD_ROOT)).toBe(true);
  });

  // 这是本文件存在的首要理由：文件名可以是用户起的，
  // 拿来直接拼路径就是任意文件读写
  it("拒绝 ../ 逃逸", () => {
    expect(() => resolveStoragePath("../../.env")).toThrow(/越界/);
    expect(() => resolveStoragePath("projects/../../../etc/passwd")).toThrow(/越界/);
    expect(() => resolveStoragePath("projects/abc/../../../../secret")).toThrow(/越界/);
  });

  it("拒绝绝对路径", () => {
    expect(() => resolveStoragePath("C:\\Windows\\System32\\config")).toThrow(/越界/);
    expect(() => resolveStoragePath("/etc/passwd")).toThrow(/越界/);
  });

  it("刚好停在根目录边界上的也算越界", () => {
    expect(() => resolveStoragePath("..")).toThrow(/越界/);
  });
});

describe("isAllowedUpload · 类型白名单", () => {
  it("放行常见的申报材料格式", () => {
    expect(isAllowedUpload("application/pdf", "申报书.pdf")).toBe(true);
    expect(
      isAllowedUpload(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "结题报告.docx",
      ),
    ).toBe(true);
    expect(isAllowedUpload("image/png", "见刊页.png")).toBe(true);
  });

  it("扩展名大小写不敏感", () => {
    expect(isAllowedUpload("application/pdf", "申报书.PDF")).toBe(true);
  });

  // 谎报 MIME 是最容易的绕过手法
  it("MIME 与扩展名对不上就拒绝", () => {
    expect(isAllowedUpload("application/pdf", "木马.exe")).toBe(false);
    expect(isAllowedUpload("image/png", "脚本.js")).toBe(false);
  });

  it("不收可执行文件与 HTML", () => {
    expect(isAllowedUpload("application/x-msdownload", "a.exe")).toBe(false);
    expect(isAllowedUpload("text/html", "a.html")).toBe(false);
    expect(isAllowedUpload("application/javascript", "a.js")).toBe(false);
  });

  it("没有扩展名的一律拒绝", () => {
    expect(isAllowedUpload("application/pdf", "申报书")).toBe(false);
  });
});

describe("saveUpload · 磁盘文件名", () => {
  const pdf = () =>
    new File([new Uint8Array([37, 80, 68, 70])], "申报书.pdf", { type: "application/pdf" });

  it("磁盘名是随机的，不用用户给的名字", async () => {
    const saved = await saveUpload(pdf(), projectScope("test-scope"), TEST_UPLOAD_ROOT);
    expect(saved.storagePath).toMatch(/^projects\/test-scope\/[0-9a-f-]{36}\.pdf$/);
    // 原始文件名不该出现在磁盘路径里
    expect(saved.storagePath).not.toContain("申报书");
    expect(saved.size).toBe(4);
  });

  it("同名文件两次上传不会互相覆盖", async () => {
    const a = await saveUpload(pdf(), projectScope("test-scope"), TEST_UPLOAD_ROOT);
    const b = await saveUpload(pdf(), projectScope("test-scope"), TEST_UPLOAD_ROOT);
    expect(a.storagePath).not.toBe(b.storagePath);
  });

  it("带路径分隔符的恶意文件名不会逃出目录", async () => {
    const evil = new File([new Uint8Array([1])], "../../../.env.pdf", {
      type: "application/pdf",
    });
    const saved = await saveUpload(evil, projectScope("test-scope"), TEST_UPLOAD_ROOT);
    expect(saved.storagePath).not.toContain("..");
    expect(resolveStoragePath(saved.storagePath, TEST_UPLOAD_ROOT).startsWith(TEST_UPLOAD_ROOT)).toBe(true);
  });

  it("目录名不合法时直接抛错", async () => {
    await expect(saveUpload(pdf(), "../escape", TEST_UPLOAD_ROOT)).rejects.toThrow(/不合法/);
    await expect(saveUpload(pdf(), "projects/../..", TEST_UPLOAD_ROOT)).rejects.toThrow(/不合法/);
  });
});

describe("resolveStoragePath with an isolated root", () => {
  it("rejects traversal and absolute paths without touching the default uploads root", () => {
    expect(() => resolveStoragePath("../escape", TEST_UPLOAD_ROOT)).toThrow();
    expect(() => resolveStoragePath("/etc/passwd", TEST_UPLOAD_ROOT)).toThrow();
    expect(() => resolveStoragePath("C:\\Windows\\System32", TEST_UPLOAD_ROOT)).toThrow();
  });

  it("rejects Windows, UNC, extended, and POSIX absolute paths on every host OS", () => {
    for (const candidate of [
      "C:\\Windows\\System32",
      "c:/Windows/System32",
      "\\\\server\\share\\secret",
      "\\\\?\\C:\\Windows\\System32",
      "\\\\?\\UNC\\server\\share\\secret",
      "/etc/passwd",
    ]) {
      expect(() => resolveStoragePath(candidate, TEST_UPLOAD_ROOT), candidate).toThrow();
    }
  });
});

describe("personalScope", () => {
  it("个人常用文档使用不与课题或成果混用的专属目录", () => {
    expect(personalScope()).toBe("personal-documents");
  });
});

describe("canPreviewInline", () => {
  it("PDF 和图片能内联预览", () => {
    expect(canPreviewInline("application/pdf")).toBe(true);
    expect(canPreviewInline("image/png")).toBe(true);
  });

  // 浏览器渲染不了 docx，只能下载——这是"在线浏览"这件事的现实边界
  it("Office 文档不能内联预览", () => {
    expect(
      canPreviewInline(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });
});

describe("白名单自洽", () => {
  it("每个 MIME 至少配一个扩展名，且都以点开头小写", () => {
    for (const [mime, extensions] of Object.entries(ALLOWED_MIME_TYPES)) {
      expect(extensions.length, mime).toBeGreaterThan(0);
      for (const extension of extensions) {
        expect(extension, mime).toMatch(/^\.[a-z0-9]+$/);
      }
    }
  });
});
