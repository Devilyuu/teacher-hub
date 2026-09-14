#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ ! -t 0 ]; then
  echo "请在交互式终端中运行本脚本，避免把口令写进命令行或聊天记录。" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
ENV_FILE="$PWD/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "找不到 $ENV_FILE" >&2
  exit 1
fi

read -r -s -p "请输入新的登录口令（至少 8 个字符）: " NEW_PASSCODE
echo
read -r -s -p "请再输入一次: " CONFIRM_PASSCODE
echo

if [ "$NEW_PASSCODE" != "$CONFIRM_PASSCODE" ]; then
  echo "两次输入不一致，未做任何修改。" >&2
  exit 1
fi
if [ "${#NEW_PASSCODE}" -lt 8 ]; then
  echo "口令至少需要 8 个字符，未做任何修改。" >&2
  exit 1
fi

ROLLBACK_FILE="$(mktemp "$PWD/.env.rollback.XXXXXX")"
cp -p "$ENV_FILE" "$ROLLBACK_FILE"
ENV_UPDATED=0

rollback_on_error() {
  set +e
  if [ "$ENV_UPDATED" -eq 1 ] && [ -f "$ROLLBACK_FILE" ]; then
    mv -f "$ROLLBACK_FILE" "$ENV_FILE"
    docker compose --profile full up -d --no-deps --no-build --force-recreate app >/dev/null 2>&1
    echo "应用未能健康启动，已恢复原口令与会话密钥。" >&2
  else
    rm -f "$ROLLBACK_FILE"
  fi
}
trap rollback_on_error ERR INT TERM

# 口令通过文件描述符 3 传给 Python，不出现在 argv 或进程环境中。
python3 - "$ENV_FILE" 3<<<"$NEW_PASSCODE" <<'PY'
import json
import os
import secrets
import sys
from pathlib import Path

path = Path(sys.argv[1])
passcode = os.fdopen(3, encoding="utf-8").read()
if passcode.endswith("\n"):
    passcode = passcode[:-1]

updates = {
    "APP_PASSCODE": json.dumps(passcode, ensure_ascii=False),
    "APP_SESSION_SECRET": json.dumps(secrets.token_urlsafe(48)),
}
lines = path.read_text(encoding="utf-8").splitlines()
seen: set[str] = set()
output: list[str] = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line else ""
    if key in updates:
        output.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")

temporary = path.with_name(f".env.tmp.{os.getpid()}")
temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, path)
PY

ENV_UPDATED=1
unset NEW_PASSCODE CONFIRM_PASSCODE

docker compose --profile full up -d --no-deps --no-build --force-recreate app

STATUS=""
for _ in $(seq 1 40); do
  STATUS="$(docker inspect -f '{{.State.Health.Status}}' keticompass-app 2>/dev/null || true)"
  if [ "$STATUS" = "healthy" ]; then
    break
  fi
  if [ "$STATUS" = "unhealthy" ]; then
    echo "应用健康检查失败。" >&2
    exit 1
  fi
  sleep 1
done
if [ "$STATUS" != "healthy" ]; then
  echo "等待应用健康检查超时。" >&2
  exit 1
fi

ENV_UPDATED=0
rm -f "$ROLLBACK_FILE" "$HOME/.keticompass-initial-passcode"
trap - ERR INT TERM

echo "登录口令已更新，会话密钥已轮换，应用健康。请使用新口令登录。"
