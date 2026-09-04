#!/usr/bin/env bash
# 每日备份数据库（记忆 + 向量库），保留最近 7 份
# crontab 示例：0 3 * * * /opt/mostarmanus/scripts/backup_db.sh >> /opt/mostarmanus/data/backup.log 2>&1
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

BACKUP_DIR="$PROJECT_DIR/data/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

docker exec mostar-db pg_dump -U "${POSTGRES_USER:-mostar}" "${POSTGRES_DB:-mostar}" \
    | gzip > "$BACKUP_DIR/mostar-$STAMP.sql.gz"

# 只保留最近 7 份
ls -1t "$BACKUP_DIR"/mostar-*.sql.gz | tail -n +8 | xargs -r rm -f
echo "[$STAMP] backup done: mostar-$STAMP.sql.gz"
