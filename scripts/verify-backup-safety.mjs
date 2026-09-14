import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backup = readFileSync(resolve(projectRoot, "scripts", "backup.sh"), "utf8");
const restore = readFileSync(resolve(projectRoot, "scripts", "restore.sh"), "utf8");

const checks = [
  ["backup.sh 设置 umask 077", backup.includes("umask 077")],
  ["backup.sh 只清理时间戳目录", backup.includes("拒绝清理非时间戳目录")],
  ["restore.sh 先恢复到临时库验证", restore.includes("CHECK_DB=")],
  ["restore.sh 等待数据库健康", restore.includes("up -d --wait postgres")],
  ["restore.sh 支持无损验证", restore.includes('--verify-only')],
  ["restore.sh 停止 Caddy 后恢复证书", restore.includes("stop app caddy") && restore.includes("caddy.tar.gz")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  console.error("备份/恢复安全检查失败：");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("备份/恢复安全检查通过");
