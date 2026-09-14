/**
 * 附件的磁盘存储（PRD 第 5 节：V1 存本地目录，数据库只存相对路径）。
 *
 * 两条安全底线：
 * 1. **磁盘文件名由本程序生成，绝不用用户给的名字。** 原始文件名只存进数据库，
 *    下载时通过 Content-Disposition 还原。用户可以把文件命名成
 *    `../../.env`，直接拿来拼路径就是任意文件写入。
 * 2. **每次由相对路径还原绝对路径时都要复查它没跑出上传根目录。**
 *    即使路径来自我们自己的数据库也要查——库被改过、迁移出错都可能让它越界。
 */
// 这个模块碰磁盘，绝不能进浏览器包。加上 server-only 后，
// 客户端组件误 import 会当场报一句人话，而不是丢出
// "chunking context does not support external modules (node:fs/promises)"
import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, parse, posix, relative, resolve, win32 } from "node:path";

/** 上传根目录。docker-compose 把宿主机 ./data/uploads 挂到容器同名路径 */
/**
 * Resolve a server-side upload override without allowing an environment typo to
 * turn an E2E cleanup into a workspace (or filesystem) cleanup.
 */
function normalizeWindowsPathForComparison(path: string): string {
  let normalized = path.replaceAll("/", "\\");
  if (/^\\\\\?\\UNC\\/i.test(normalized)) {
    normalized = `\\\\${normalized.slice(8)}`;
  } else if (/^\\\\\?\\/i.test(normalized)) {
    normalized = normalized.slice(4);
  }
  return win32.normalize(normalized).toLocaleLowerCase("en-US");
}

export function isSameOrAncestorPath(
  ancestor: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const normalize = platform === "win32"
    ? normalizeWindowsPathForComparison
    : (path: string) => posix.normalize(path);
  const normalizedAncestor = normalize(ancestor);
  const normalizedTarget = normalize(target);
  const fromAncestor = pathApi.relative(normalizedAncestor, normalizedTarget);
  return fromAncestor === "" || (
    fromAncestor !== ".." &&
    !fromAncestor.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(fromAncestor)
  );
}

function canonicalizeFromNearestExistingAncestor(candidate: string): string {
  let existingAncestor = candidate;
  for (;;) {
    try {
      lstatSync(existingAncestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("UPLOAD_ROOT cannot be inspected safely");
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new Error("UPLOAD_ROOT has no resolvable ancestor");
      }
      existingAncestor = parent;
    }
  }

  let canonicalAncestor: string;
  try {
    canonicalAncestor = realpathSync.native(existingAncestor);
  } catch {
    // lstat can see a dangling symlink/junction even though realpath cannot.
    throw new Error("UPLOAD_ROOT contains a dangling or unresolvable link");
  }
  if (!lstatSync(canonicalAncestor).isDirectory()) {
    throw new Error("UPLOAD_ROOT nearest existing ancestor must be a directory");
  }
  return resolve(canonicalAncestor, relative(existingAncestor, candidate));
}

export function resolveUploadRoot(override?: string, workingDirectory = process.cwd()): string {
  const usesDefault = override === undefined;
  const requestedRoot = usesDefault ? resolve(workingDirectory, "data", "uploads") : override;
  if (!requestedRoot.trim() || requestedRoot.includes("\0") || !isAbsolute(requestedRoot)) {
    throw new Error("UPLOAD_ROOT 必须是非空的绝对路径");
  }

  const lexicalCandidate = resolve(requestedRoot);
  const candidate = canonicalizeFromNearestExistingAncestor(lexicalCandidate);
  if (parse(candidate).root === candidate) {
    throw new Error("UPLOAD_ROOT 不能是文件系统根目录");
  }

  const cwd = realpathSync.native(workingDirectory);
  if (isSameOrAncestorPath(candidate, cwd)) {
    throw new Error("UPLOAD_ROOT 不能是仓库目录或其祖先目录");
  }
  if (isSameOrAncestorPath(cwd, candidate) && !isSameOrAncestorPath(cwd, lexicalCandidate)) {
    throw new Error("UPLOAD_ROOT cannot enter the workspace through a symlink or junction");
  }
  return usesDefault ? lexicalCandidate : candidate;
}

/** Docker 默认仍挂载 cwd/data/uploads；测试可提供单独的绝对目录。 */
export const UPLOAD_ROOT = resolveUploadRoot(process.env.UPLOAD_ROOT);

/** 单个文件大小上限。申报书带图能到十几兆，留够余量 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * 允许的类型。刻意不放 .exe/.js/.html 之类——
 * 本工具装的是申报材料，没有理由收可执行文件或能在同源下运行脚本的 HTML。
 */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/zip": [".zip"],
  "text/plain": [".txt"],
  "text/markdown": [".md"],
};

/** 浏览器能直接渲染、可以内联预览的类型。其余一律走下载 */
const INLINE_VIEWABLE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function canPreviewInline(mimeType: string): boolean {
  return INLINE_VIEWABLE.has(mimeType);
}

export function isAllowedUpload(mimeType: string, filename: string): boolean {
  const extensions = ALLOWED_MIME_TYPES[mimeType];
  if (!extensions) return false;
  // 类型和扩展名要对得上，防止把 .exe 改名成 .pdf 再谎报 MIME
  return extensions.includes(extname(filename).toLowerCase());
}

/**
 * 生成磁盘上的文件名。**完全丢弃用户给的名字**，只保留扩展名，
 * 且扩展名要在白名单里才留，否则不带扩展名。
 */
function safeDiskName(filename: string): string {
  const extension = extname(filename).toLowerCase();
  const known = Object.values(ALLOWED_MIME_TYPES).some((list) => list.includes(extension));
  return known ? `${randomUUID()}${extension}` : randomUUID();
}

/**
 * 把相对路径还原成绝对路径，并确认它确实落在上传根目录内。
 * 越界一律抛错，不返回也不静默降级。
 */
export function resolveStoragePath(storagePath: string, uploadRoot = UPLOAD_ROOT): string {
  if (win32.isAbsolute(storagePath) || posix.isAbsolute(storagePath)) {
    throw new Error(`附件路径越界，拒绝访问：${storagePath}`);
  }
  const absolute = resolve(uploadRoot, storagePath);

  // 必须直接比对前缀，**不能只靠 relative() 是否以 .. 开头**：
  // Windows 上跨盘符时 relative("E:\\uploads", "C:\\Windows") 返回的是
  // "C:\\Windows" 而不是一串 ../，只查 .. 会让绝对路径整个溜过去。
  const withinRoot = isSameOrAncestorPath(uploadRoot, absolute);

  if (!withinRoot) {
    throw new Error(`附件路径越界，拒绝访问：${storagePath}`);
  }
  // 根目录本身不是合法的附件路径
  if (isSameOrAncestorPath(absolute, uploadRoot)) {
    throw new Error(`附件路径越界，拒绝访问：${storagePath}`);
  }
  return absolute;
}

export type SavedUpload = {
  storagePath: string;
  size: number;
};

/**
 * 落盘。
 * @param scope 分目录用，如 `projects/<id>`。只允许字母数字和横线，
 *              同样不信任调用方——它最终来自 URL 参数。
 */
export async function saveUpload(
  file: File,
  scope: string,
  uploadRoot = UPLOAD_ROOT,
): Promise<SavedUpload> {
  if (!/^[a-zA-Z0-9/_-]+$/.test(scope)) {
    throw new Error(`附件目录名不合法：${scope}`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`);
  }

  const storagePath = `${scope}/${safeDiskName(file.name)}`;
  const absolute = resolveStoragePath(storagePath, uploadRoot);

  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);

  return { storagePath, size: bytes.byteLength };
}

export async function readUpload(storagePath: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storagePath));
}

/**
 * 分块读一个附件，给材料 ZIP 用（规格 7.4：**流式生成**，
 * 不把所有附件一次性读进内存）。
 *
 * 返回的是「每调用一次就重新读一遍」的工厂，而不是一个用完就废的流：
 * ZIP 打包器要读两遍（先算 CRC 再写数据），拿到同一个已消费的流会读空。
 *
 * 路径照样过 `resolveStoragePath` 的越界检查——**这里不能因为"路径来自
 * 我们自己规划好的条目"就跳过**，规划的输入终究来自数据库。
 */
export function openUploadStream(storagePath: string): () => AsyncIterable<Uint8Array> {
  const absolute = resolveStoragePath(storagePath);
  return () => createReadStream(absolute, { highWaterMark: 64 * 1024 });
}

/** 删附件时用。文件已经不在了也算成功——目的是"确保它没了" */
export async function deleteUpload(storagePath: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** 上传目录下的相对路径拼法，集中在这里免得各处拼错 */
export function projectScope(projectId: string): string {
  return `projects/${projectId}`;
}

export function achievementScope(achievementId: string): string {
  return `achievements/${achievementId}`;
}

/** 个人常用文档与课题、成果附件物理分目录存放。 */
export function personalScope(): string {
  return "personal-documents";
}

/** 参赛材料：赛事通知、报名表、获奖证书（指导参赛模块）。 */
export function competitionEntryScope(entryId: string): string {
  return `competitions/${entryId}`;
}

/** 学生荣誉的奖状照片/扫描件（班主任模块），同样单独一个目录。 */
export function studentHonorScope(honorId: string): string {
  return `student-honors/${honorId}`;
}

/**
 * 回流教案单独一个目录。
 *
 * 用回流记录的 id 而不是外部系统的 id 分目录：外部 id 由对方决定，
 * 可能带路径分隔符或重名，直接拼进路径就是目录穿越
 */
export function teachingImportScope(teachingImportId: string): string {
  return `teaching-imports/${teachingImportId}`;
}
