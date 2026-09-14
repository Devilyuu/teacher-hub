import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPostgresTmpfsStorage,
  assertExactContainerAbsent,
  buildE2eChildEnv,
  assertNoLoadableDotenvFiles,
  chooseE2eFinalOutcome,
  containerLabelsMatch,
  countExactCellMatches,
  extractRunnerCleanupLabels,
  quoteDatabaseIdentifier,
  runCleanupSteps,
  startAbortableChild,
  validateOwnedTempParent,
  validateE2eDatabaseName,
  waitForPostSignalExit,
} from "./e2e-runner-helpers.mjs";

describe("E2E runner safety helpers", () => {
  function controllableSignal(initiallyAborted = false) {
    const listeners = new Set();
    return {
      aborted: initiallyAborted,
      listeners,
      addEventListener(_name, listener) { listeners.add(listener); },
      removeEventListener(_name, listener) { listeners.delete(listener); },
      abort() {
        this.aborted = true;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it("does not spawn when the command signal is already aborted", () => {
    const signal = controllableSignal(true);
    const activeChildren = new Set();
    let spawnCalls = 0;
    expect(() => startAbortableChild({
      signal,
      activeChildren,
      spawnChild: () => { spawnCalls += 1; return {}; },
      onAbort: () => {},
    })).toThrow(/interrupted/i);
    expect(spawnCalls).toBe(0);
    expect(activeChildren.size).toBe(0);
    expect(signal.listeners.size).toBe(0);
  });

  it("terminates an abort that lands between spawn and listener registration", () => {
    const signal = controllableSignal();
    const child = { pid: 123 };
    const activeChildren = new Set();
    const terminated = [];
    const registration = startAbortableChild({
      signal,
      activeChildren,
      spawnChild: () => child,
      beforeAbortArm: () => signal.abort(),
      onAbort: (value) => terminated.push(value),
    });
    expect(terminated).toEqual([child]);
    expect(activeChildren.has(child)).toBe(true);
    registration.dispose();
    expect(activeChildren.size).toBe(0);
    expect(signal.listeners.size).toBe(0);
  });

  it("announces readiness only after the child is tracked and abort is armed", () => {
    const signal = controllableSignal();
    const child = { pid: 456 };
    const activeChildren = new Set();
    const registration = startAbortableChild({
      signal,
      activeChildren,
      spawnChild: () => child,
      onAbort: () => {},
      onArmed: () => {
        expect(activeChildren.has(child)).toBe(true);
        expect(signal.listeners.size).toBe(1);
      },
    });
    registration.dispose();
    expect(activeChildren.size).toBe(0);
    expect(signal.listeners.size).toBe(0);
  });

  it("only accepts runner-generated database names and quotes them", () => {
    const name = "teacher_desk_e2e_0123456789abcdef";
    expect(validateE2eDatabaseName(name)).toBe(name);
    expect(quoteDatabaseIdentifier(name)).toBe('"teacher_desk_e2e_0123456789abcdef"');
    expect(() => validateE2eDatabaseName("postgres")).toThrow();
    expect(() => validateE2eDatabaseName("teacher_desk_e2e_x;DROP DATABASE postgres")).toThrow();
  });

  it("uses an allowlist and overwrites application configuration", () => {
    const child = buildE2eChildEnv(
      { PATH: "bin", DATABASE_URL: "real", APP_PASSCODE: "real", TENCENT_SECRET_KEY: "real", HOME: "home" },
      { DATABASE_URL: "test-url", APP_PASSCODE: "generated", APP_SESSION_SECRET: "session", UPLOAD_ROOT: "/tmp/e2e", E2E_RUN_ID: "run" },
    );
    expect(child).toMatchObject({ PATH: "bin", HOME: "home", DATABASE_URL: "test-url", APP_PASSCODE: "generated", APP_SESSION_SECRET: "session", UPLOAD_ROOT: "/tmp/e2e", E2E_RUN_ID: "run" });
    expect(child.TENCENT_SECRET_KEY).toBeUndefined();
    expect(child.E2E_ADMIN_URL).toBeUndefined();
  });

  it("rejects every dotenv variant except the tracked example", () => {
    const file = (name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
    expect(() => assertNoLoadableDotenvFiles([file(".env.example"), file("package.json")])).not.toThrow();
    expect(() => assertNoLoadableDotenvFiles([file(".ENV"), file(".Env.Local")])).toThrow(/\.ENV/);
    expect(() => assertNoLoadableDotenvFiles([file(".env.production"), file(".env.example")])).toThrow(/\.env\.production/);
  });

  it("only allows an ordinary lowercase .env.example file", () => {
    const entry = (name, kind) => ({
      name,
      isFile: () => kind === "file",
      isDirectory: () => kind === "directory",
      isSymbolicLink: () => kind === "symlink",
    });
    expect(() => assertNoLoadableDotenvFiles([entry(".ENV.EXAMPLE", "file")])).toThrow();
    expect(() => assertNoLoadableDotenvFiles([entry(".env.example", "directory")])).toThrow();
    expect(() => assertNoLoadableDotenvFiles([entry(".env.example", "symlink")])).toThrow();
  });

  it("requires both cleanup labels to match before removing a container", () => {
    expect(containerLabelsMatch({ "teacher-desk.e2e": "true", "teacher-desk.e2e-run": "run-1" }, "run-1")).toBe(true);
    expect(containerLabelsMatch({ "teacher-desk.e2e": "true", "teacher-desk.e2e-run": "other" }, "run-1")).toBe(false);
    expect(containerLabelsMatch({ "teacher-desk.e2e-run": "run-1" }, "run-1")).toBe(false);
  });

  it("proves exact container absence only after a successful daemon query with empty stdout", async () => {
    const calls = [];
    await expect(assertExactContainerAbsent("teacher-desk-e2e-run.1", async (args) => {
      calls.push(args);
      return { code: 0, stdout: "\n" };
    })).resolves.toBe(true);
    expect(calls).toEqual([[
      "ps", "-a",
      "--filter", "name=^/teacher-desk-e2e-run\\.1$",
      "--format", "{{.Names}}",
    ]]);

    await expect(assertExactContainerAbsent("teacher-desk-e2e-run", async () => ({
      code: 1,
      stdout: "",
    }))).rejects.toThrow(/daemon query/i);
    await expect(assertExactContainerAbsent("teacher-desk-e2e-run", async () => ({
      code: 0,
      stdout: "teacher-desk-e2e-run\n",
    }))).rejects.toThrow(/still exists/i);
    await expect(assertExactContainerAbsent("teacher-desk-e2e-run", async () => {
      throw new Error("spawn failed");
    })).rejects.toThrow(/spawn failed/i);
  });

  it("validates a run-bound marker before returning an owned temp parent", async () => {
    const runId = "0123456789abcdef";
    const prefix = `teacher-desk-e2e-${runId}-`;
    const parent = await mkdtemp(join(tmpdir(), prefix));
    try {
      await mkdir(join(parent, "uploads"));
      await writeFile(join(parent, ".teacher-desk-e2e-marker"), runId, "utf8");
      await expect(validateOwnedTempParent(parent, { prefix, markerName: ".teacher-desk-e2e-marker", runId })).resolves.toBeTruthy();
      await writeFile(join(parent, ".teacher-desk-e2e-marker"), "other-run", "utf8");
      await expect(validateOwnedTempParent(parent, { prefix, markerName: ".teacher-desk-e2e-marker", runId })).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked marker", async () => {
    const runId = "fedcba9876543210";
    const prefix = `teacher-desk-e2e-${runId}-`;
    const parent = await mkdtemp(join(tmpdir(), prefix));
    const external = join(parent, "external-marker-directory");
    try {
      await mkdir(external);
      await symlink(external, join(parent, ".teacher-desk-e2e-marker"), process.platform === "win32" ? "junction" : "dir");
      await expect(validateOwnedTempParent(parent, { prefix, markerName: ".teacher-desk-e2e-marker", runId })).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refuses deletion after marker removal but continues later cleanup steps", async () => {
    const runId = "abcdef0123456789";
    const markerName = ".teacher-desk-e2e-marker";
    const prefix = `teacher-desk-e2e-${runId}-`;
    const parent = await mkdtemp(join(tmpdir(), prefix));
    const markerPath = join(parent, markerName);
    let laterCleanupRan = false;
    try {
      await writeFile(markerPath, runId, "utf8");
      await unlink(markerPath);
      const failures = await runCleanupSteps([
        ["owned-parent", async () => {
          const target = await validateOwnedTempParent(parent, { prefix, markerName, runId });
          await rm(target, { recursive: true });
        }],
        ["later-resource", async () => { laterCleanupRan = true; }],
      ]);
      expect(failures).toEqual(["owned-parent"]);
      expect(laterCleanupRan).toBe(true);
      expect(existsSync(parent)).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("counts an E2E title exactly once across workbook cells", () => {
    expect(countExactCellMatches([["title"], ["E2E title"], ["E2E title suffix"]], "E2E title")).toBe(1);
  });

  it("continues cleanup steps after a failure", async () => {
    const calls = [];
    const failures = await runCleanupSteps([
      ["db", async () => { calls.push("db"); throw new Error("sensitive url=postgres://secret"); }],
      ["uploads", async () => { calls.push("uploads"); }],
    ]);
    expect(calls).toEqual(["db", "uploads"]);
    expect(failures).toEqual(["db"]);
  });

  it("accepts Docker tmpfs storage with no bind or volume source", () => {
    expect(() => assertPostgresTmpfsStorage({
      Mounts: [],
      Binds: null,
      Tmpfs: {
        "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m",
      },
    })).not.toThrow();
    expect(() => assertPostgresTmpfsStorage({
      Mounts: [{
        Type: "tmpfs",
        Source: "",
        Destination: "/var/lib/postgresql/data",
        RW: true,
      }],
      Binds: null,
      Tmpfs: {
        "/var/lib/postgresql/data": "size=512m,noexec,nodev,nosuid,rw",
      },
    })).not.toThrow();
  });

  it.each([
    ["missing tmpfs declaration", { Mounts: [], Binds: null, Tmpfs: {} }],
    ["bind source", {
      Mounts: [{ Type: "bind", Source: "/tmp/pg", Destination: "/var/lib/postgresql/data", RW: true }],
      Binds: ["/tmp/pg:/var/lib/postgresql/data"],
      Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m" },
    }],
    ["volume source", {
      Mounts: [{ Type: "volume", Source: "pgdata", Destination: "/var/lib/postgresql/data", RW: true }],
      Binds: ["pgdata:/var/lib/postgresql/data"],
      Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m" },
    }],
    ["nested volume source", {
      Mounts: [{ Type: "volume", Source: "pgwal", Destination: "/var/lib/postgresql/data/pg_wal", RW: true }],
      Binds: null,
      Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m" },
    }],
    ["nested bind source", {
      Mounts: [],
      Binds: ["/tmp/pgwal:/var/lib/postgresql/data/pg_wal"],
      Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m" },
    }],
    ["nested tmpfs mount", {
      Mounts: [],
      Binds: null,
      Tmpfs: {
        "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m",
        "/var/lib/postgresql/data/pg_wal": "rw,nosuid,nodev,noexec,size=512m",
      },
    }],
    ["unsafe tmpfs options", {
      Mounts: [],
      Binds: null,
      Tmpfs: { "/var/lib/postgresql/data": "rw,size=512m" },
    }],
  ])("rejects Postgres storage when inspect reports %s", (_label, inspect) => {
    expect(() => assertPostgresTmpfsStorage(inspect)).toThrow(/Postgres tmpfs storage/i);
  });

  it("makes cleanup failure exit 1 take priority over a clean SIGTERM exit 143", () => {
    expect(chooseE2eFinalOutcome({
      cleanupFailures: ["container"],
      signalExitCode: 143,
      cleanupDrill: false,
      expectedDrillReached: false,
      primaryFailure: false,
    })).toEqual({ kind: "cleanup-failure", exitCode: 1 });
    expect(chooseE2eFinalOutcome({
      cleanupFailures: [],
      signalExitCode: 143,
      cleanupDrill: false,
      expectedDrillReached: false,
      primaryFailure: false,
    })).toEqual({ kind: "signal", exitCode: 143 });
  });

  it("extracts safe runner cleanup labels for signal-drill diagnostics", () => {
    expect(extractRunnerCleanupLabels([
      "E2E cleanup failed for: pg-data-parent, container",
      "other output",
    ].join("\n"))).toEqual(["pg-data-parent", "container"]);
    expect(extractRunnerCleanupLabels("E2E interrupted; cleanup completed.")).toEqual([]);
  });

  it("bounds post-signal waiting, escalates to SIGKILL, and then settles in a fixed window", async () => {
    const kills = [];
    const started = Date.now();
    const result = await waitForPostSignalExit({
      exitPromise: new Promise(() => {}),
      kill: (signal) => { kills.push(signal); return true; },
      deadlineMs: 10,
      killGraceMs: 10,
    });
    expect(result).toEqual({
      exitCode: null,
      deadlineExceeded: true,
      killRequested: true,
      reaped: false,
    });
    expect(kills).toEqual(["SIGKILL"]);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("preserves a normal 143 exit before the post-signal deadline", async () => {
    const kills = [];
    await expect(waitForPostSignalExit({
      exitPromise: Promise.resolve(143),
      kill: (signal) => { kills.push(signal); return true; },
      deadlineMs: 10,
      killGraceMs: 10,
    })).resolves.toEqual({
      exitCode: 143,
      deadlineExceeded: false,
      killRequested: false,
      reaped: true,
    });
    expect(kills).toEqual([]);
  });
});
