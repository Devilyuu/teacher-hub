#!/usr/bin/env node
/**
 * 演示环境启动器。
 *
 * 存在的唯一理由是**把「指向演示库」这件事收在一处**：迁移、灌数据、起服务
 * 三条命令都从 .env.demo 读连接串，谁也没机会写成真实库。仓库里没有
 * dotenv-cli / cross-env，为这件事装一个不值得，所以用纯 Node 拼环境。
 *
 * 用法：
 *   node scripts/demo.mjs create-db   在同一个 postgres 实例上建演示库
 *   node scripts/demo.mjs migrate     对演示库跑 prisma migrate deploy
 *   node scripts/demo.mjs seed        灌演示数据（会先清空演示库）
 *   node scripts/demo.mjs reset       migrate + seed
 *   node scripts/demo.mjs dev         用演示库起 next dev
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DEMO_ENV_PATH = resolve(ROOT, ".env.demo");

function fail(message, hint) {
  console.error("");
  console.error(`  ✗ ${message}`);
  if (hint) {
    console.error("");
    for (const line of hint.split("\n")) console.error(`    ${line}`);
  }
  console.error("");
  process.exit(1);
}

/** 极简 .env 解析：KEY=VALUE，支持引号与 # 注释。够用即可。 */
function parseEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

if (!existsSync(DEMO_ENV_PATH)) {
  fail(
    "没有找到 .env.demo",
    "先复制模板再填：\n\n  cp .env.demo.example .env.demo\n\n它和 .env 是两份独立配置，.env.demo 只指向演示库。",
  );
}

const demoEnv = parseEnvFile(DEMO_ENV_PATH);
const databaseUrl = demoEnv.DATABASE_URL;

if (!databaseUrl) {
  fail(".env.demo 里没有 DATABASE_URL");
}

/** 和 seed-demo.ts 同一道护栏，在这里再挡一次——命令行离真实库更近。 */
let demoDbName;
try {
  demoDbName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
} catch {
  fail(".env.demo 的 DATABASE_URL 不是合法连接串");
}

if (!/demo/i.test(demoDbName)) {
  fail(
    `.env.demo 指向的库名是 ${JSON.stringify(demoDbName)}，不含 “demo”`,
    "演示流程会清空目标库，因此只接受名字里带 demo 的库。\n把 .env.demo 的 DATABASE_URL 改成 keticompass_demo 之类的名字。",
  );
}

const childEnv = { ...process.env, ...demoEnv };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) fail(`执行 ${command} 失败：${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** 读主 .env 里 postgres 的账号信息——演示库建在同一个实例上。 */
function readMainEnv() {
  const path = resolve(ROOT, ".env");
  return existsSync(path) ? parseEnvFile(path) : {};
}

function createDatabase() {
  const main = readMainEnv();
  const user = main.POSTGRES_USER ?? "keti";
  console.log(`  在 docker compose 的 postgres 上创建库 ${demoDbName} …`);
  // SQL 走 stdin 而不是 `-c "…"`：Windows 上 shell:true 会按空格重新切分参数，
  // `CREATE DATABASE x` 会被拆成三个，psql 只收到 `CREATE`。
  const result = spawnSync(
    "docker",
    [
      "compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml",
      "exec", "-T", "postgres",
      // 没有 ON_ERROR_STOP 时，psql 从 stdin 读脚本即使报错也退 0，
      // 「已存在」和「真失败」就分不开了
      "psql", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", "postgres",
    ],
    {
      cwd: ROOT,
      env: process.env,
      input: `CREATE DATABASE "${demoDbName}";\n`,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      // docker 是真 exe，不需要 shell；不走 shell 就没有参数拼接与转义问题
      shell: false,
    },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) console.log(`  ${output.split("\n").join("\n  ")}`);

  if (result.status !== 0) {
    if (/already exists/i.test(output)) {
      console.log(`  库 ${demoDbName} 已存在，跳过创建。`);
      return;
    }
    fail(
      "创建演示库失败",
      "确认 postgres 容器在跑：\n\n  npm run db:up",
    );
  }
  console.log(`  ✓ 已创建 ${demoDbName}`);
}

const task = process.argv[2];

switch (task) {
  case "create-db":
    createDatabase();
    break;
  case "migrate":
    run("npx", ["prisma", "migrate", "deploy"]);
    break;
  case "seed":
    run("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts"]);
    break;
  case "reset":
    run("npx", ["prisma", "migrate", "deploy"]);
    run("npx", ["tsx", "--conditions=react-server", "scripts/seed-demo.ts"]);
    break;
  case "dev":
    console.log(`  next dev → 演示库 ${demoDbName}`);
    run("npx", ["next", "dev"]);
    break;
  default:
    fail(
      `未知子命令 ${JSON.stringify(task ?? "")}`,
      "可用：create-db | migrate | seed | reset | dev",
    );
}
