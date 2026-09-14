import { describe, expect, it, vi } from "vitest";

import { probeRuntimeImageContents } from "./runtime-image-content-probe.mjs";

describe("runtime-image content probe", () => {
  it("runs the existing exclusion probe with a hard timeout and SIGKILL", () => {
    const spawnSyncImpl = vi.fn(() => ({ status: 0, signal: null, stdout: "", stderr: "" }));

    probeRuntimeImageContents({ image: "test:image", timeoutMs: 30_000, spawnSyncImpl });

    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        "test:image",
      ]),
      expect.objectContaining({
        encoding: "utf8",
        timeout: 30_000,
        killSignal: "SIGKILL",
      }),
    );
    const shellProbe = spawnSyncImpl.mock.calls[0][1].at(-1);
    expect(shellProbe).toContain("/app/.env /app/docs /app/data/postgres /app/data/caddy");
    expect(shellProbe).toContain("/app/app /app/lib /app/test");
    expect(shellProbe).toContain("/var/lib/teacher-desk-audio");
    expect(shellProbe).toContain("-d /var/lib/teacher-desk-audio");
    expect(shellProbe).toContain("find /var/lib/teacher-desk-audio -mindepth 1");
  });

  it("classifies content-probe timeout separately", () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });

    expect(() =>
      probeRuntimeImageContents({
        image: "test:image",
        timeoutMs: 20,
        spawnSyncImpl: () => ({ status: null, signal: "SIGKILL", error }),
      }),
    ).toThrowError(expect.objectContaining({ code: "PROBE_TIMEOUT", timeoutMs: 20 }));
  });

  it("classifies content-probe startup errors separately", () => {
    const error = Object.assign(new Error("docker missing"), { code: "ENOENT" });

    expect(() =>
      probeRuntimeImageContents({
        image: "test:image",
        spawnSyncImpl: () => ({ status: null, signal: null, error }),
      }),
    ).toThrowError(expect.objectContaining({ code: "PROBE_SPAWN_FAILED" }));
  });

  it("preserves a non-zero content-probe exit and its output", () => {
    expect(() =>
      probeRuntimeImageContents({
        image: "test:image",
        spawnSyncImpl: () => ({
          status: 17,
          signal: null,
          stdout: "UNEXPECTED_RUNTIME_PATH:/app/app",
          stderr: "",
        }),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PROBE_EXIT",
        exitCode: 17,
        stdout: "UNEXPECTED_RUNTIME_PATH:/app/app",
      }),
    );
  });
});
