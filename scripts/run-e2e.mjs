import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import {
  assertExactContainerAbsent,
  assertNoLoadableDotenvFiles,
  assertPostgresTmpfsStorage,
  buildE2eChildEnv,
  chooseE2eFinalOutcome,
  containerLabelsMatch,
  quoteDatabaseIdentifier,
  runCleanupSteps,
  startAbortableChild,
  validateE2eDatabaseName,
  validateOwnedTempParent,
} from "./e2e-runner-helpers.mjs";

const cwd = process.cwd();
const { Client } = pg;
const runId = randomBytes(12).toString("hex");
const databaseName = `teacher_desk_e2e_${runId}`;
const containerName = `teacher-desk-e2e-${runId}`;
const uploadPrefix = `teacher-desk-e2e-${runId}-`;
const uploadMarker = ".teacher-desk-e2e-marker";
const injectedCleanupDrill = process.argv.includes("--cleanup-drill") || process.env.E2E_CLEANUP_FAILURE_DRILL === "1";
const startFailureDrill = process.argv.includes("--start-failure-drill");
const cleanupDrill = injectedCleanupDrill || startFailureDrill;
const shutdownController = new AbortController();
const activeChildren = new Set();
const activeClients = new Set();

let createdDatabase = false;
let containerCreated = false;
let containerStarted = false;
let startFailureArmed = false;
let startFailurePortServer;
let uploadRoot;
let uploadParent;
let adminUrl;
let childEnv;
let devServer;
let signalExitCode;
let cleanupPromise;

class ExpectedCleanupDrillError extends Error {}

function command(name) {
  return process.platform === "win32" && (name === "npm" || name === "npx") ? `${name}.cmd` : name;
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveWait(true);
    });
  });
}

async function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    const requested = await new Promise((resolveKill) => {
      killer.once("error", () => resolveKill(false));
      killer.once("exit", (code) => resolveKill(code === 0));
    });
    return requested && await waitForChildExit(child, 5_000);
  }

  let requested = false;
  try {
    process.kill(-child.pid, "SIGTERM");
    requested = true;
  } catch {}
  if (await waitForChildExit(child, 5_000)) return requested;
  try {
    process.kill(-child.pid, "SIGKILL");
    requested = true;
  } catch {}
  return requested && await waitForChildExit(child, 5_000);
}

function runCommand(name, args, {
  env,
  capture = false,
  allowedExitCodes = [0],
  timeoutMs = 120_000,
  signal = shutdownController.signal,
  lifecycleLabel,
} = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let child;
    let registration;
    let stdout = "";
    let timedOut = false;
    let terminationPromise;
    let timer;
    const terminate = () => {
      terminationPromise ??= terminateProcessTree(child);
      return terminationPromise;
    };
    const rejectAfterTerminationAttempt = (message) => {
      void terminate().then(() => {
        if (child.exitCode === null && child.signalCode === null) rejectRun(new Error(message));
      });
    };
    const onAbort = () => rejectAfterTerminationAttempt(`${name} interrupted`);
    registration = startAbortableChild({
      signal,
      activeChildren,
      spawnChild: () => spawn(command(name), args, {
        cwd,
        env,
        detached: process.platform !== "win32",
        shell: process.platform === "win32" && (name === "npm" || name === "npx"),
        stdio: capture ? ["ignore", "pipe", "ignore"] : "inherit",
        windowsHide: true,
      }),
      onAbort,
      prepareChild: (spawnedChild) => {
        child = spawnedChild;
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.once("error", (error) => {
          clearTimeout(timer);
          registration?.dispose();
          rejectRun(error);
        });
        child.once("exit", async (code) => {
          clearTimeout(timer);
          registration?.dispose();
          const terminatedByRequest = terminationPromise ? await terminationPromise : false;
          if (signal?.aborted) {
            if (lifecycleLabel && terminatedByRequest) {
              console.error(`E2E shutdown terminated: ${lifecycleLabel} child process group`);
            }
            return rejectRun(new Error(`${name} interrupted`));
          }
          if (timedOut) return rejectRun(new Error(`${name} timed out`));
          if (!allowedExitCodes.includes(code ?? -1)) return rejectRun(new Error(`${name} exited unsuccessfully`));
          resolveRun({ code, stdout });
        });
      },
      onArmed: () => {
        if (lifecycleLabel) {
          console.log(`E2E lifecycle armed: ${lifecycleLabel} child tracked and abort handler ready`);
        }
      },
    });
    timer = setTimeout(() => {
      timedOut = true;
      rejectAfterTerminationAttempt(`${name} timed out`);
    }, timeoutMs);
  });
}

function startServer(name, args, options = {}) {
  const child = spawn(command(name), args, {
    cwd,
    detached: process.platform !== "win32",
    shell: process.platform === "win32" && (name === "npm" || name === "npx"),
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}

function safeEnv(extra) {
  return buildE2eChildEnv(process.env, extra);
}

function throwIfInterrupted() {
  if (shutdownController.signal.aborted) throw new Error("E2E interrupted");
}

function delay(ms) {
  return new Promise((resolveDelay, rejectDelay) => {
    const onAbort = () => {
      clearTimeout(timer);
      rejectDelay(new Error("E2E interrupted"));
    };
    const timer = setTimeout(() => {
      shutdownController.signal.removeEventListener("abort", onAbort);
      resolveDelay();
    }, ms);
    shutdownController.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function rejectDotenvFiles() {
  const entries = await readdir(cwd, { withFileTypes: true });
  assertNoLoadableDotenvFiles(entries);
  const example = entries.find((entry) => entry.name === ".env.example");
  if (example) {
    const stat = await lstat(join(cwd, example.name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("E2E runner refuses non-ordinary .env.example");
  }
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      resolvePort({ server, port: server.address().port });
    });
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function waitFor(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    throwIfInterrupted();
    try {
      const signal = AbortSignal.any([shutdownController.signal, AbortSignal.timeout(3_000)]);
      if ((await fetch(url, { signal })).ok) return;
    } catch {}
    await delay(1_000);
  }
  throw new Error("Timed out waiting for the isolated E2E server");
}

async function withAdminClient(action, { ignoreShutdown = false } = {}) {
  if (!ignoreShutdown) throwIfInterrupted();
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  activeClients.add(client);
  try {
    await client.connect();
    if (!ignoreShutdown) throwIfInterrupted();
    return await action(client);
  } finally {
    activeClients.delete(client);
    await client.end().catch(() => {});
  }
}

async function provisionDockerAdmin() {
  let port;
  if (startFailureDrill) {
    const reservation = await reservePort();
    startFailurePortServer = reservation.server;
    port = reservation.port;
  } else {
    port = await freePort();
  }
  const user = `e2e_${runId.slice(0, 12)}`;
  const password = randomBytes(24).toString("base64url");
  await runCommand("docker", [
    "create", "--name", containerName,
    "--label", "teacher-desk.e2e=true",
    "--label", `teacher-desk.e2e-run=${runId}`,
    "-e", `POSTGRES_USER=${user}`,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", "POSTGRES_DB=postgres",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m",
    "-p", `127.0.0.1:${port}:5432`,
    "postgres:17-alpine",
  ]);
  containerCreated = true;
  const { stdout } = await runCommand("docker", [
    "inspect",
    "--format",
    '{"Mounts":{{json .Mounts}},"Binds":{{json .HostConfig.Binds}},"Tmpfs":{{json .HostConfig.Tmpfs}}}',
    containerName,
  ], { capture: true, signal: null, timeoutMs: 15_000 });
  assertPostgresTmpfsStorage(JSON.parse(stdout.trim()));
  console.log("E2E Postgres storage: tmpfs");
  if (startFailureDrill) startFailureArmed = true;
  await runCommand("docker", ["start", containerName], { signal: null, timeoutMs: 30_000 });
  containerStarted = true;
  adminUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
  for (let i = 0; i < 60; i++) {
    try {
      await withAdminClient(async () => {});
      return;
    } catch {
      throwIfInterrupted();
      await delay(1_000);
    }
  }
  throw new Error("Temporary Postgres container did not become ready");
}

async function sql(statement, options) {
  return withAdminClient((client) => client.query(statement), options);
}

async function databaseExists(options) {
  return withAdminClient(async (client) => (
    await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName])
  ).rowCount > 0, options);
}

async function inspectContainerLabels() {
  const { stdout } = await runCommand("docker", ["inspect", "--format", "{{json .Config.Labels}}", containerName], {
    capture: true,
    signal: null,
    timeoutMs: 15_000,
  });
  return JSON.parse(stdout.trim());
}

async function assertOwnedContainerAbsent() {
  return assertExactContainerAbsent(containerName, (args) => runCommand("docker", args, {
    capture: true,
    signal: null,
    timeoutMs: 15_000,
  }));
}

async function removeOwnedTempParent(target, prefix, markerName) {
  const canonicalTarget = await validateOwnedTempParent(target, { prefix, markerName, runId });
  await rm(canonicalTarget, { recursive: true, force: true });
  if (cleanupDrill && existsSync(canonicalTarget)) throw new Error("owned temp directory remains");
}

function cleanup() {
  cleanupPromise ??= runCleanupSteps([
    ["dev-server", async () => { if (devServer) await terminateProcessTree(devServer); }],
    ["commands", async () => { await Promise.all([...activeChildren].map(terminateProcessTree)); }],
    ["start-failure-port", async () => { await closeServer(startFailurePortServer); }],
    ["database", async () => {
      if (createdDatabase && adminUrl) {
        await sql(`DROP DATABASE IF EXISTS ${quoteDatabaseIdentifier(databaseName)} WITH (FORCE)`, { ignoreShutdown: true });
        if (cleanupDrill && await databaseExists({ ignoreShutdown: true })) throw new Error("generated database remains");
      }
    }],
    ["upload-parent", async () => {
      if (uploadParent) await removeOwnedTempParent(uploadParent, uploadPrefix, uploadMarker);
    }],
    ["container", async () => {
      if (!containerCreated) return;
      const labels = await inspectContainerLabels();
      if (!containerLabelsMatch(labels, runId)) throw new Error("container labels do not belong to this run");
      await runCommand("docker", ["rm", "-f", containerName], { signal: null, timeoutMs: 30_000 });
      if (cleanupDrill) await assertOwnedContainerAbsent();
    }],
  ]);
  return cleanupPromise;
}

function requestShutdown(exitCode) {
  signalExitCode ??= exitCode;
  shutdownController.abort();
  for (const client of activeClients) void client.end().catch(() => {});
}

process.once("SIGINT", () => requestShutdown(130));
process.once("SIGTERM", () => requestShutdown(143));

let primaryFailure = false;
let expectedDrillReached = false;
try {
  await rejectDotenvFiles();
  validateE2eDatabaseName(databaseName);
  uploadParent = await mkdtemp(join(tmpdir(), uploadPrefix));
  await writeFile(join(uploadParent, uploadMarker), runId, { mode: 0o600 });
  uploadRoot = join(uploadParent, "uploads");
  await mkdir(uploadRoot);
  adminUrl = process.env.E2E_POSTGRES_ADMIN_URL;
  if (!adminUrl) await provisionDockerAdmin();
  console.log(`E2E container: ${containerStarted ? containerName : "external test server"}`);
  console.log(`E2E upload root: ${uploadRoot}`);
  await sql(`CREATE DATABASE ${quoteDatabaseIdentifier(databaseName)}`);
  createdDatabase = true;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const passcode = randomBytes(24).toString("base64url");
  childEnv = safeEnv({
    DATABASE_URL: databaseUrl.toString(),
    APP_PASSCODE: passcode,
    APP_SESSION_SECRET: randomBytes(32).toString("base64url"),
    UPLOAD_ROOT: uploadRoot,
    E2E_RUN_ID: runId,
    E2E_YEAR: String(new Date().getFullYear()),
  });
  console.log(`E2E database: ${databaseName}`);
  const migrationArgs = process.env.E2E_SIGNAL_PROBE === "1"
    ? ["scripts/e2e-migration-signal-probe.mjs"]
    : ["node_modules/prisma/build/index.js", "migrate", "deploy"];
  await runCommand(process.execPath, migrationArgs, { env: childEnv, lifecycleLabel: "migration" });
  await runCommand(process.execPath, ["node_modules/prisma/build/index.js", "db", "seed"], { env: childEnv });
  await runCommand(process.execPath, ["node_modules/tsx/dist/cli.mjs", "e2e/seed-fixture.ts"], { env: childEnv });
  if (injectedCleanupDrill) {
    expectedDrillReached = true;
    throw new ExpectedCleanupDrillError("expected cleanup drill injection");
  }
  const port = await freePort();
  const baseURL = `http://localhost:${port}`;
  devServer = startServer(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", String(port)], { env: childEnv });
  await waitFor(`${baseURL}/api/health`);
  await runCommand(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
    env: { ...childEnv, E2E_BASE_URL: baseURL, E2E_PASSCODE: passcode },
  });
} catch (error) {
  if (startFailureDrill && startFailureArmed && containerCreated && !containerStarted
    && !shutdownController.signal.aborted) {
    expectedDrillReached = true;
  } else if (!(error instanceof ExpectedCleanupDrillError && expectedDrillReached)) {
    primaryFailure = true;
  }
} finally {
  const cleanupFailures = await cleanup();
  const outcome = chooseE2eFinalOutcome({
    cleanupFailures,
    signalExitCode,
    cleanupDrill,
    expectedDrillReached,
    primaryFailure,
  });
  if (outcome.kind === "cleanup-failure") {
    console.error(`E2E cleanup failed for: ${cleanupFailures.join(", ")}`);
  } else if (outcome.kind === "signal") {
    console.error("E2E interrupted; cleanup completed. No secrets are printed.");
  } else if (outcome.kind === "cleanup-drill-success") {
    console.log("Cleanup drill completed: expected injected failure was cleaned without residuals.");
  } else if (outcome.kind === "failure") {
    console.error("E2E failed before completion; cleanup completed. No secrets are printed.");
  }
  process.exitCode = outcome.exitCode;
}
