#!/usr/bin/env bash
#
# 每日备份：数据库 pg_dump + 附件目录 + Caddy 证书。
#
# 在**服务器上**跑（仓库根目录下）。用法：
#   ./scripts/backup.sh              备份到默认目录
#   BACKUP_DIR=/mnt/xxx ./scripts/backup.sh
#
# 装进 crontab（每天 03:20）：
#   20 3 * * * cd /opt/keticompass && ./scripts/backup.sh >> /var/log/keticompass-backup.log 2>&1
#
# 三样东西丢了都要命，一样都不能漏：
#   - 数据库    课题、成果、规则表、任务会议……全部是自己一条条录进来的履历
#   - 附件      data/uploads，支撑材料原件，库里只存路径，丢了没法从任何地方重建
#   - 证书      data/caddy，删了会重新申请，而 Let's Encrypt 每域名每周只签 5 次
# AUDIO_TEMP_ROOT is intentionally excluded: it is a private, expiring working set, not an attachment archive.
#
# **一致性说明**：pg_dump 自身是事务一致的，但它和 uploads 打包之间隔着几秒，
# 期间新传的附件可能入了库却没进这份包。单人使用、凌晨三点跑，这个窗口可以接受；
# 恢复后若发现个别附件打不开，去库里按 uploadedAt 找那几条重传即可。

set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

BACKUP_DIR="${BACKUP_DIR:-/opt/keticompass-backups}"
# 保留份数。每份约 30–40MB（库 dump 压缩后 + 27MB 附件），14 份约 500MB
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
if [ "$BACKUP_DIR" = "/" ] || [ "$BACKUP_DIR" = "$REPO_DIR" ]; then
  echo "备份目录不能是根目录或仓库根目录：$BACKUP_DIR" >&2
  exit 1
fi

# 库名和用户从 .env 取，跟 docker-compose.yml 的默认值保持一致
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PG_USER="${POSTGRES_USER:-keti}"
PG_DB="${POSTGRES_DB:-keticompass}"

STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

echo "[$(date '+%F %T')] 开始备份 → $DEST"

# ── 1. 数据库 ──────────────────────────────────────────────
# 走容器内的 pg_dump，版本必然和服务端一致（宿主机上装的 client 版本可能更低，
# 会报 "server version mismatch" 而拒绝导出）。
# -Fc 自定义格式：自带压缩，且能用 pg_restore 选择性恢复单张表。
# -T 不加：全库导出，一张表都不落。
docker compose exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$DEST/db.dump"

# 空 dump 是最经典的备份事故——脚本天天绿，要用时才发现是个 0 字节文件。
# 这里两道校验：文件不能太小，且 pg_restore 必须能列出对象清单。
DUMP_BYTES="$(wc -c < "$DEST/db.dump")"
if [ "$DUMP_BYTES" -lt 10240 ]; then
  echo "备份失败：db.dump 只有 ${DUMP_BYTES} 字节，几乎肯定是空的" >&2
  exit 1
fi
TABLE_COUNT="$(docker compose exec -T postgres pg_restore -l < "$DEST/db.dump" | grep -c 'TABLE DATA' || true)"
if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "备份失败：dump 里只有 ${TABLE_COUNT} 张表有数据，不正常" >&2
  exit 1
fi

# ── 2. 附件 ────────────────────────────────────────────────
# 直接打包宿主机上的目录（compose 把它挂进容器，宿主机这份就是原件）
tar -czf "$DEST/uploads.tar.gz" -C "$REPO_DIR/data" uploads

# ── 3. Caddy 证书 ──────────────────────────────────────────
if [ -d "$REPO_DIR/data/caddy" ]; then
  tar -czf "$DEST/caddy.tar.gz" -C "$REPO_DIR/data" caddy
fi

# ── 4. 清单 ────────────────────────────────────────────────
# 恢复时要知道这份包对应哪个代码版本——迁移是往前走的，用新库配旧代码会出事
{
  echo "备份时间   $(date '+%F %T %Z')"
  echo "代码版本   $(git rev-parse --short HEAD 2>/dev/null || echo '未知')"
  echo "最新迁移   $(ls prisma/migrations | grep -v migration_lock | tail -1)"
  echo "数据库表   ${TABLE_COUNT} 张有数据"
  echo "文件"
  ls -lh "$DEST" | tail -n +2 | awk '{print "  " $9 "  " $5}'
} > "$DEST/manifest.txt"

# ── 5. 滚动清理 ────────────────────────────────────────────
# 按目录名倒序（名字是时间戳，字典序即时间序），留最新 KEEP 份
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n "+$((KEEP + 1))" | while read -r old; do
  case "$old" in
    "$BACKUP_DIR"/*) ;;
    *)
      echo "拒绝清理越界目录：$old" >&2
      exit 1
      ;;
  esac
  if ! [[ "$(basename "$old")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$ ]]; then
    echo "拒绝清理非时间戳目录：$old" >&2
    continue
  fi
  echo "  清理旧备份 $(basename "$old")"
  rm -rf "$old"
done

echo "[$(date '+%F %T')] 备份完成，共 $(du -sh "$DEST" | cut -f1)"
echo
cat "$DEST/manifest.txt"
