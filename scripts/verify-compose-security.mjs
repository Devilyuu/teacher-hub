import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findNextImageProxyViolations } from "./verify-proxy-rules.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

function verifyNextImageProxyRules() {
  violations.push(
    ...findNextImageProxyViolations({
      caddyfile: readFileSync(resolve(projectRoot, "Caddyfile"), "utf8"),
      nginxConfig: readFileSync(
        resolve(projectRoot, "deploy/nginx/desk.conf"),
        "utf8",
      ),
    }),
  );
}

verifyNextImageProxyRules();
if (violations.length > 0) {
  console.error("生产代理路径隔离检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

function readCompose(files) {
  const args = ["compose"];
  for (const file of files) args.push("-f", file);
  args.push("config", "--format", "json");
  const result = spawnSync("docker", args, { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "无法读取 Docker Compose 配置");
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

const baseConfig = readCompose(["docker-compose.yml"]);
for (const [serviceName, service] of Object.entries(baseConfig.services ?? {})) {
  if (serviceName !== "caddy" && Array.isArray(service.ports) && service.ports.length > 0) {
    violations.push(`基础配置 ${serviceName}: ${JSON.stringify(service.ports)}`);
  }
}

const serverConfig = readCompose(["docker-compose.yml", "docker-compose.server.yml"]);
for (const [serviceName, service] of Object.entries(serverConfig.services ?? {})) {
  const ports = Array.isArray(service.ports) ? service.ports : [];
  if (serviceName === "postgres" && ports.length > 0) {
    violations.push(`服务器配置 ${serviceName}: ${JSON.stringify(ports)}`);
  }
  if (serviceName === "app") {
    if (ports.length !== 1) {
      violations.push(`服务器配置 app 应只有一个回环端口: ${JSON.stringify(ports)}`);
      continue;
    }
    const [port] = ports;
    if (port.host_ip !== "127.0.0.1" || Number(port.target) !== 3000) {
      violations.push(`服务器配置 app 未安全绑定回环地址: ${JSON.stringify(port)}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Compose 端口隔离检查失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  "安全检查通过：生产代理仅拒绝 /_next/image，数据库不发布端口，服务器应用仅绑定 127.0.0.1",
);
