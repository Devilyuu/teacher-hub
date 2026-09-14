import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import {
  assertExactContainerAbsent,
  extractRunnerCleanupLabels,
  waitForPostSignalExit,
} from "./e2e-runner-helpers.mjs";

if (process.platform === "win32") {
  console.log("Real SIGTERM delivery is not available on Windows; the POSIX CI probe performs this check.");
  process.exit(0);
}

const { Client } = pg;
const cwd = process.cwd();
const child = spawn(process.execPath, ["scripts/run-e2e.mjs"], {
  cwd,
  env: { ...process.env, E2E_SIGNAL_PROBE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let uploadRoot;
let databaseName;
let containerName;
let signalSent = false;
let lifecycleArmed = false;
let migrationChildReady = false;
let postgresStorageTmpfs = false;
let terminationRequested = false;
let resolveTerminationRequested;
const terminationRequestedPromise = new Promise((resolveTermination) => {
  resolveTerminationRequested = resolveTermination;
});
const exitPromise = new Promise((resolveExit, rejectExit) => {
  child.once("error", rejectExit);
  child.once("exit", resolveExit);
});

function requestTermination(isSignalInjection) {
  if (terminationRequested) return;
  terminationRequested = true;
  if (isSignalInjection) signalSent = true;
  resolveTerminationRequested();
  try { child.kill("SIGTERM"); } catch {}
}

function consume(chunk, stream) {
  const text = chunk.toString();
  output += text;
  stream.write(text);
  uploadRoot ??= output.match(/^E2E upload root: (.+)$/m)?.[1]?.trim();
  databaseName ??= output.match(/^E2E database: (teacher_desk_e2e_[a-z0-9]+)$/m)?.[1];
  const container = output.match(/^E2E container: (.+)$/m)?.[1]?.trim();
  if (container && container !== "external test server") containerName ??= container;
  lifecycleArmed ||= output.includes("E2E lifecycle armed: migration child tracked and abort handler ready");
  migrationChildReady ||= output.includes("E2E migration probe child ready");
  postgresStorageTmpfs ||= output.includes("E2E Postgres storage: tmpfs");
  if (!signalSent && lifecycleArmed && migrationChildReady) {
    requestTermination(true);
  }
}

child.stdout.on("data", (chunk) => consume(chunk, process.stdout));
child.stderr.on("data", (chunk) => consume(chunk, process.stderr));

const timeout = setTimeout(() => {
  requestTermination(false);
}, 120_000);

const phase = await Promise.race([
  exitPromise.then((exitCode) => ({ kind: "exit", exitCode })),
  terminationRequestedPromise.then(() => ({ kind: "termination" })),
]);
clearTimeout(timeout);
let exitCode = phase.kind === "exit" ? phase.exitCode : null;
let postSignalResult;
if (phase.kind === "termination") {
  postSignalResult = await waitForPostSignalExit({
    exitPromise,
    kill: (signal) => child.kill(signal),
    deadlineMs: 60_000,
    killGraceMs: 5_000,
  });
  exitCode = postSignalResult.exitCode;
}

const failures = [];
if (postSignalResult?.deadlineExceeded) failures.push("post-signal cleanup deadline");
if (postSignalResult?.deadlineExceeded && !postSignalResult.reaped) failures.push("runner SIGKILL settle");
if (!signalSent) failures.push("signal injection point");
if (!lifecycleArmed) failures.push("migration lifecycle handshake");
if (!migrationChildReady) failures.push("migration child readiness");
if (!postgresStorageTmpfs) failures.push("Postgres tmpfs storage handshake");
if (!output.includes("E2E shutdown terminated: migration child process group")) {
  failures.push("migration process-group termination confirmation");
}
if (exitCode !== 143) failures.push("SIGTERM exit code");
if (!uploadRoot || existsSync(dirname(uploadRoot))) failures.push("upload parent cleanup");

if (!containerName) failures.push("container handshake");
else {
  try {
    await assertExactContainerAbsent(containerName, (args) => new Promise((resolveProbe, rejectProbe) => {
      const probe = spawn("docker", args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let stdout = "";
      let settled = false;
      let probeTimeout;
      const finish = (action) => {
        if (settled) return;
        settled = true;
        clearTimeout(probeTimeout);
        action();
      };
      probe.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      probe.once("error", (error) => finish(() => rejectProbe(error)));
      probe.once("exit", (code) => finish(() => resolveProbe({ code, stdout })));
      probeTimeout = setTimeout(() => {
        try { probe.kill("SIGKILL"); } catch {}
        finish(() => rejectProbe(new Error("Docker absence probe timed out")));
      }, 15_000);
    }));
  } catch {
    failures.push("container cleanup");
  }
}

for (const label of extractRunnerCleanupLabels(output)) {
  failures.push(`runner cleanup: ${label}`);
}

if (process.env.E2E_POSTGRES_ADMIN_URL && databaseName) {
  const client = new Client({
    connectionString: process.env.E2E_POSTGRES_ADMIN_URL,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });
  try {
    await client.connect();
    const residue = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (residue.rowCount) failures.push("database cleanup");
  } finally {
    await client.end().catch(() => {});
  }
}

if (failures.length) {
  console.error(`SIGTERM cleanup drill failed for: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("SIGTERM cleanup drill passed: exit 143 and no owned container/tmpfs or upload residue.");
}
