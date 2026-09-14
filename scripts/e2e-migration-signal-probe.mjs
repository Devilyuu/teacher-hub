import { spawn } from "node:child_process";

const migration = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

console.log("E2E migration probe child ready");

const code = await new Promise((resolveExit, rejectExit) => {
  migration.once("error", rejectExit);
  migration.once("exit", resolveExit);
});
if (code !== 0) process.exit(code ?? 1);

// Keep the probe-only process group alive after a very fast migration so the
// parent can deterministically deliver SIGTERM through the real runCommand path.
await new Promise(() => {});
