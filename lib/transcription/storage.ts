import "server-only";

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const DIRECTORY_PREFIX = "recording-";
const MARKER = ".teacher-desk-recording";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RECORDING_PATH = new RegExp(`^${DIRECTORY_PREFIX}(${UUID})/(${UUID})\\.([a-z0-9]+)$`, "i");

function sameOrInside(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..");
}

export function resolveAudioTempRoot(
  configured = process.env.AUDIO_TEMP_ROOT?.trim() || join(tmpdir(), "teacher-desk-audio"),
  options: { cwd?: string; uploadRoot?: string } = {},
): string {
  if (!isAbsolute(configured)) throw new Error("AUDIO_TEMP_ROOT 必须是绝对路径");
  const root = resolve(/* turbopackIgnore: true */ configured);
  const cwd = resolve(/* turbopackIgnore: true */ options.cwd ?? process.cwd());
  const uploadRoot = options.uploadRoot
    ? resolve(/* turbopackIgnore: true */ options.uploadRoot)
    : null;
  if (uploadRoot && (sameOrInside(root, uploadRoot) || sameOrInside(uploadRoot, root))) {
    throw new Error("AUDIO_TEMP_ROOT 必须与 UPLOAD_ROOT 独立");
  }
  if (sameOrInside(root, cwd) || sameOrInside(cwd, root)) {
    throw new Error("AUDIO_TEMP_ROOT 不能位于仓库内或包含仓库");
  }
  if (root === parse(root).root) throw new Error("AUDIO_TEMP_ROOT 不能是文件系统根目录");
  return root;
}

export const AUDIO_TEMP_ROOT = resolveAudioTempRoot();

async function assertNoSymlinkComponents(target: string): Promise<void> {
  const root = parse(target).root;
  const parts = target.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(/* turbopackIgnore: true */ current, part);
    try {
      const info = await lstat(/* turbopackIgnore: true */ current);
      if (info.isSymbolicLink()) throw new Error("录音临时路径不能包含符号链接或连接点");
      if (!info.isDirectory()) throw new Error("录音临时路径的祖先必须是目录");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function ensureAudioTempRoot(root: string): Promise<string> {
  await assertNoSymlinkComponents(root);
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  await chmod(/* turbopackIgnore: true */ root, 0o700);
  const canonical = await realpath(/* turbopackIgnore: true */ root);
  if (resolve(canonical) !== resolve(root)) throw new Error("录音临时根不能经过符号链接或连接点");
  return canonical;
}

export function createRecordingStoragePath(originalName: string): string {
  const extension = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!extension) throw new Error("音频文件缺少扩展名");
  return `${DIRECTORY_PREFIX}${randomUUID()}/${randomUUID()}.${extension}`;
}

function normalizeStoragePath(storagePath: string): string {
  const normalized = storagePath.replaceAll("\\", "/");
  if (isAbsolute(storagePath) || !RECORDING_PATH.test(normalized)) {
    throw new Error("录音存储路径不合法");
  }
  return normalized;
}

export async function writeRecordingFile(file: File, storagePath: string, root = AUDIO_TEMP_ROOT) {
  const normalized = normalizeStoragePath(storagePath);
  const safeRoot = await ensureAudioTempRoot(resolveAudioTempRoot(root, { cwd: process.cwd() }));
  const absolutePath = resolve(/* turbopackIgnore: true */ safeRoot, normalized);
  const directory = dirname(absolutePath);
  if (!sameOrInside(absolutePath, safeRoot)) throw new Error("录音存储路径不合法");
  await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700 });
  await chmod(/* turbopackIgnore: true */ directory, 0o700);
  await writeFile(
    join(/* turbopackIgnore: true */ directory, MARKER),
    basename(directory),
    { mode: 0o600, flag: "wx" },
  );
  await pipeline(
    Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream),
    createWriteStream(/* turbopackIgnore: true */ absolutePath, { flags: "wx", mode: 0o600 }),
  );
  return { absolutePath, storagePath: normalized };
}

export async function saveRecordingFile(file: File, root = AUDIO_TEMP_ROOT) {
  const storagePath = createRecordingStoragePath(file.name);
  try {
    return await writeRecordingFile(file, storagePath, root);
  } catch (error) {
    await removeRecordingFile(storagePath, root).catch(() => {});
    throw error;
  }
}

async function validateOwnedRecording(storagePath: string, root: string, allowPartial = false) {
  const normalized = normalizeStoragePath(storagePath);
  const safeRoot = await ensureAudioTempRoot(resolveAudioTempRoot(root, { cwd: process.cwd() }));
  const absolute = resolve(/* turbopackIgnore: true */ safeRoot, normalized);
  const directory = dirname(absolute);
  if (!sameOrInside(absolute, safeRoot)) throw new Error("录音存储路径不合法");

  let directoryInfo;
  try {
    directoryInfo = await lstat(/* turbopackIgnore: true */ directory);
  } catch (error) {
    if (allowPartial && (error as NodeJS.ErrnoException).code === "ENOENT") return { absolute, directory };
    throw error;
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("录音目录不安全");
  const canonicalDirectory = await realpath(/* turbopackIgnore: true */ directory);
  if (!sameOrInside(canonicalDirectory, safeRoot)) throw new Error("录音目录越界");
  try {
    const marker = await readFile(join(/* turbopackIgnore: true */ canonicalDirectory, MARKER), "utf8");
    if (marker !== basename(canonicalDirectory)) throw new Error("录音目录归属标记不匹配");
  } catch (error) {
    if (!allowPartial || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!allowPartial) await access(/* turbopackIgnore: true */ absolute);
  return { absolute, directory: canonicalDirectory };
}

export async function resolveRecordingFile(storagePath: string, root = AUDIO_TEMP_ROOT): Promise<string> {
  return (await validateOwnedRecording(storagePath, root)).absolute;
}

export async function removeRecordingFile(storagePath: string, root = AUDIO_TEMP_ROOT): Promise<void> {
  const owned = await validateOwnedRecording(storagePath, root, true);
  await rm(/* turbopackIgnore: true */ owned.directory, { recursive: true, force: true });
}
