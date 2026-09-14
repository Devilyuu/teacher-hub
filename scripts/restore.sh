#!/usr/bin/env bash
#
# 从 backup.sh 产出的备份包恢复。**会覆盖现有数据**，所以要显式加 --yes。
#
# 用法：
#   ./scripts/restore.sh /opt/keticompass-backups/2026-07-29_0320           # 只演示要做什么
#   ./scripts/restore.sh /opt/keticompass-backups/2026-07-29_0320 --verify-only  # 只做可恢复性验证
#   ./scripts/restore.sh /opt/keticompass-backups/2026-07-29_0320 --yes          # 真的执行
#
# 两个场景都用它：
#   1. 服务器出事，从备份恢复
#   2. **首次部署**——本地 backup.sh 打一份包，scp 上服务器，在这里恢复。
#      部署不是空库启动，已有的课题和成果都要一起搬上去
#
# 恢复期间 app 会停掉。不停的话 Prisma 的连接池会占着库，dropdb 直接报
# "database is being accessed by other users"。

set -euo pipefail
umask 077

SRC="${1:-}"
CONFIRM="${2:-}"

if [ -z "$SRC" ]; then
  echo "用法：$0 <备份目录> [--verify-only|--yes]" >&2
  exit 1
fi
if [ ! -f "$SRC/db.dump" ]; then
  echo "错误：$SRC 下找不到 db.dump" >&2
  exit 1
fi
SRC="$(cd "$(dirname "$SRC")" && pwd -P)/$(basename "$SRC")"

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PG_USER="${POSTGRES_USER:-keti}"
PG_DB="${POSTGRES_DB:-keticompass}"
case "$PG_USER:$PG_DB" in
  *[!a-zA-Z0-9_:]*)
    echo "数据库用户和库名只能包含字母、数字与下划线" >&2
    exit 1
    ;;
esac

verify_archive_paths() {
  local archive="$1"
  local root="$2"
  local entry
  while IFS= read -r entry; do
    case "$entry" in
      "$root"|"$root/"*) ;;
      *)
        echo "压缩包含越界路径：$entry" >&2
        return 1
        ;;
    esac
    case "/$entry/" in
      *"/../"*|*"/./"*)
        echo "压缩包含路径穿越：$entry" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
}

echo "备份包    $SRC"
[ -f "$SRC/manifest.txt" ] && sed 's/^/  /' "$SRC/manifest.txt"
echo
echo "将要执行："
echo "  1. 把 db.dump 恢复到临时库并核验"
echo "  2. 停 app（若使用内置 Caddy，也一并停止）"
echo "  3. 删除并重建数据库 $PG_DB，从 db.dump 恢复"
echo "  4. 恢复附件与可选的 Caddy 数据"
echo "  5. 重启数据库与应用（启动时会自动跑 prisma migrate deploy）"
echo

if [ "$CONFIRM" != "--yes" ] && [ "$CONFIRM" != "--verify-only" ]; then
  echo "这是**演示**，什么都没做。确认无误后重跑并在末尾加 --yes"
  exit 0
fi

if [ -f "$SRC/uploads.tar.gz" ]; then
  verify_archive_paths "$SRC/uploads.tar.gz" "uploads"
fi
if [ -f "$SRC/caddy.tar.gz" ]; then
  verify_archive_paths "$SRC/caddy.tar.gz" "caddy"
fi

echo "[1/5] 验证备份可恢复"
docker compose up -d --wait postgres
CHECK_DB="${PG_DB}_restore_check_$$"
cleanup_check_db() {
  if [ -n "${CHECK_DB:-}" ]; then
    docker compose exec -T postgres dropdb -U "$PG_USER" --if-exists "$CHECK_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup_check_db EXIT

docker compose exec -T postgres dropdb -U "$PG_USER" --if-exists "$CHECK_DB" >/dev/null
docker compose exec -T postgres createdb -U "$PG_USER" "$CHECK_DB"
if ! docker compose exec -T postgres pg_restore -U "$PG_USER" -d "$CHECK_DB" \
  --no-owner --no-privileges < "$SRC/db.dump"; then
  echo "备份验证失败：db.dump 无法完整恢复到临时库，现有数据库未改动" >&2
  exit 1
fi
CHECK_TABLES="$(docker compose exec -T postgres psql -U "$PG_USER" -d "$CHECK_DB" -At -c \
  "select count(*) from pg_catalog.pg_tables where schemaname='public';")"
if [ "$CHECK_TABLES" -lt 5 ]; then
  echo "备份验证失败：临时库只有 ${CHECK_TABLES} 张业务表，现有数据库未改动" >&2
  exit 1
fi
cleanup_check_db
CHECK_DB=""
trap - EXIT

if [ "$CONFIRM" = "--verify-only" ]; then
  echo "备份可恢复性验证通过：临时数据库恢复成功，压缩包路径安全；现有数据未改动。"
  exit 0
fi

echo "[2/5] 停 app 与可选的 Caddy"
docker compose --profile full stop app caddy || true

echo "[3/5] 恢复数据库"
# dropdb 之前把残留连接踢掉，否则会报 "being accessed by other users"
docker compose exec -T postgres psql -U "$PG_USER" -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname='$PG_DB' and pid <> pg_backend_pid();" >/dev/null
docker compose exec -T postgres dropdb -U "$PG_USER" --if-exists "$PG_DB"
docker compose exec -T postgres createdb -U "$PG_USER" "$PG_DB"
# --no-owner/--no-privileges：dump 里记的属主是源库的角色名，
# 换台机器角色可能不同名，带着它恢复会一路报错
docker compose exec -T postgres pg_restore -U "$PG_USER" -d "$PG_DB" \
  --no-owner --no-privileges < "$SRC/db.dump"

echo "[4/5] 恢复附件与可选的 Caddy 数据"
if [ -f "$SRC/uploads.tar.gz" ]; then
  # 先挪开再解，不要就地覆盖——解包中途失败的话两份都残缺
  if [ -d "$REPO_DIR/data/uploads" ]; then
    mv "$REPO_DIR/data/uploads" "$REPO_DIR/data/uploads.old.$(date +%s)"
  fi
  tar -xzf "$SRC/uploads.tar.gz" -C "$REPO_DIR/data"
  # 容器里跑的是 node 用户（uid 1000），属主不对会让上传报 EACCES
  chown -R 1000:1000 "$REPO_DIR/data/uploads" 2>/dev/null || true
else
  echo "  （备份包里没有 uploads.tar.gz，跳过）"
fi

if [ -f "$SRC/caddy.tar.gz" ]; then
  if [ -d "$REPO_DIR/data/caddy" ]; then
    mv "$REPO_DIR/data/caddy" "$REPO_DIR/data/caddy.old.$(date +%s)"
  fi
  tar -xzf "$SRC/caddy.tar.gz" -C "$REPO_DIR/data"
else
  echo "  （备份包里没有 caddy.tar.gz，首次部署将由 Caddy 申请证书）"
fi

echo "[5/5] 重启数据库与应用"
docker compose --profile full up -d postgres app

echo
echo "恢复完成。核对一下条数："
docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -t -c \
  "select '课题 '||(select count(*) from \"Project\")
       ||'  成果 '||(select count(*) from \"Achievement\")
       ||'  附件 '||(select count(*) from \"Attachment\");"
echo
echo "旧的附件/证书目录留在 data/*.old.*，确认没问题后自己删"
