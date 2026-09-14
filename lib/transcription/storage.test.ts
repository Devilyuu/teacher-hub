import { access, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRecordingStoragePath,
  removeRecordingFile,
  resolveAudioTempRoot,
  saveRecordingFile,
  writeRecordingFile,
} from "./storage";

const root = resolve(tmpdir(), `teacher-desk-audio-test-${process.pid}`);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("isolated recording storage", () => {
  it("rejects relative, workspace, and upload roots", () => {
    expect(() => resolveAudioTempRoot("relative/audio", { cwd: process.cwd(), uploadRoot: root }))
      .toThrow(/绝对路径/);
    expect(() => resolveAudioTempRoot(process.cwd(), { cwd: process.cwd(), uploadRoot: root }))
      .toThrow(/仓库/);
    expect(() => resolveAudioTempRoot(root, { cwd: resolve(root, "workspace"), uploadRoot: root }))
      .toThrow(/UPLOAD_ROOT/);
  });

  it("writes into a random private directory and removes only that owned directory", async () => {
    const file = new File([Buffer.from("RIFF-audio")], "meeting.wav", { type: "audio/wav" });
    const saved = await saveRecordingFile(file, root);
    expect(saved.storagePath).toMatch(/^recording-[A-Za-z0-9_-]+[/\\][0-9a-f-]+\.wav$/);
    expect(await readFile(saved.absolutePath, "utf8")).toBe("RIFF-audio");
    if (process.platform !== "win32") {
      expect((await stat(saved.absolutePath)).mode & 0o777).toBe(0o600);
      expect((await stat(resolve(saved.absolutePath, ".."))).mode & 0o777).toBe(0o700);
    }

    await removeRecordingFile(saved.storagePath, root);
    await expect(access(saved.absolutePath)).rejects.toThrow();
    await expect(removeRecordingFile("../outside.wav", root)).rejects.toThrow(/不合法/);
  });

  it("can persist a random storage path before writing and reclaim a partial owned directory", async () => {
    const storagePath = createRecordingStoragePath("meeting.wav");
    expect(storagePath).toMatch(/^recording-[0-9a-f-]+[/\\][0-9a-f-]+\.wav$/);
    const file = new File([Buffer.from("partial-safe")], "meeting.wav", { type: "audio/wav" });
    const saved = await writeRecordingFile(file, storagePath, root);
    expect(saved.absolutePath).toContain("recording-");
    await removeRecordingFile(storagePath, root);
    await expect(access(saved.absolutePath)).rejects.toThrow();
    await expect(removeRecordingFile(storagePath, root)).resolves.toBeUndefined();
  });
});
