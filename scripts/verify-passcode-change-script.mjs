import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./change-passcode.sh", import.meta.url), "utf8");
const checks = [
  ["口令静默输入", script.includes("read -r -s")],
  ["要求二次确认", script.includes("CONFIRM_PASSCODE")],
  ["通过私有文件描述符传入口令", script.includes('3<<<"$NEW_PASSCODE"')],
  ["同时轮换会话密钥", script.includes("APP_SESSION_SECRET")],
  ["原子替换 .env", script.includes("os.replace")],
  ["重建应用容器", script.includes("--force-recreate app")],
  ["等待健康检查", script.includes("State.Health.Status")],
  ["删除初始口令提示文件", script.includes(".keticompass-initial-passcode")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length > 0) {
  console.error("生产口令修改脚本检查失败：");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("生产口令修改脚本检查通过");
