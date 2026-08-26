#!/usr/bin/env bash
#
# Dumps the household data (no schema, no ownership) out of a Postgres database.
#
# The schema is not dumped on purpose: the target gets it from `bun run db:migrate`,
# so the two databases stay described by the same drizzle migrations rather than by
# a snapshot of whatever the old one happened to look like.
#
# pg_dump runs inside a container so the client version always matches the server;
# a client older than the server refuses to dump at all.
#
# Usage:
#   SOURCE_DATABASE_URL='postgres://...:5432/postgres' ./scripts/ops/pg-dump-data.sh
#
# The URL must be a direct or session connection. A transaction pooler (port 6543
# on Supabase) cannot serve pg_dump.
set -euo pipefail

: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"

DB_SCHEMA="${DB_SCHEMA:-public}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
DUMP_DIR="${DUMP_DIR:-./tmp/db-migration}"
DUMP_FILE="${DUMP_FILE:-data-$(date +%Y%m%d-%H%M%S).sql}"

mkdir -p "$DUMP_DIR"
DUMP_DIR_ABS="$(cd "$DUMP_DIR" && pwd)"

echo "dumping schema '$DB_SCHEMA' -> $DUMP_DIR_ABS/$DUMP_FILE"

docker run --rm \
  -e PGURL="$SOURCE_DATABASE_URL" \
  -e DB_SCHEMA="$DB_SCHEMA" \
  -e DUMP_FILE="$DUMP_FILE" \
  -v "$DUMP_DIR_ABS:/dump" \
  "$PG_IMAGE" \
  bash -c 'pg_dump "$PGURL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --no-comments \
    --schema="$DB_SCHEMA" \
    --exclude-table="$DB_SCHEMA.__drizzle_migrations" \
    --file="/dump/$DUMP_FILE"'

echo "rows in dump: $(grep -c '^' "$DUMP_DIR_ABS/$DUMP_FILE") lines"
echo "done: $DUMP_DIR_ABS/$DUMP_FILE"
