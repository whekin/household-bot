#!/usr/bin/env bash
#
# Loads a data-only dump into a freshly migrated database.
#
# `session_replication_role = replica` turns off foreign key checks for the load,
# so the order pg_dump happened to choose does not matter; the whole load runs in
# one transaction, so a failure leaves the target empty rather than half filled.
#
# Refuses to run when the target already holds rows, because a second load would
# duplicate every one of them. Set FORCE=1 to override deliberately.
#
# The dump names its tables schema-qualified, so the target schema has to carry
# the same name as the source one (both are `public` here).
#
# Usage:
#   TARGET_DATABASE_URL='postgres://...:5432/postgres' \
#     DUMP_PATH=./tmp/db-migration/data-20260826-101500.sql \
#     ./scripts/ops/pg-restore-data.sh
set -euo pipefail

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${DUMP_PATH:?DUMP_PATH is required}"

DB_SCHEMA="${DB_SCHEMA:-public}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
FORCE="${FORCE:-0}"

if [ ! -f "$DUMP_PATH" ]; then
  echo "dump not found: $DUMP_PATH" >&2
  exit 1
fi

DUMP_DIR_ABS="$(cd "$(dirname "$DUMP_PATH")" && pwd)"
DUMP_NAME="$(basename "$DUMP_PATH")"

# Exact counts rather than planner estimates: an "almost empty" target is still a
# target that would end up with duplicated rows.
COUNT_ALL_ROWS="
select coalesce(sum(rows), 0)
from (
  select (
    xpath(
      '/row/count/text()',
      query_to_xml(format('select count(*) as count from %I.%I', table_schema, table_name), false, true, '')
    )
  )[1]::text::bigint as rows
  from information_schema.tables
  where table_schema = '${DB_SCHEMA}'
    and table_type = 'BASE TABLE'
    and table_name <> '__drizzle_migrations'
) counted
"

existing_rows="$(docker run --rm \
  -e PGURL="$TARGET_DATABASE_URL" \
  -e COUNT_ALL_ROWS="$COUNT_ALL_ROWS" \
  "$PG_IMAGE" \
  bash -c 'psql "$PGURL" -tAX -c "$COUNT_ALL_ROWS"')"

existing_rows="$(echo "$existing_rows" | tr -d '[:space:]')"

if [ "${existing_rows:-0}" != "0" ] && [ "$FORCE" != "1" ]; then
  echo "target already holds $existing_rows rows; refusing to load on top of them." >&2
  echo "drop and re-migrate the target, or set FORCE=1 if you know it is safe." >&2
  exit 1
fi

echo "loading $DUMP_NAME into schema '$DB_SCHEMA'"

docker run --rm \
  -e PGURL="$TARGET_DATABASE_URL" \
  -e DUMP_NAME="$DUMP_NAME" \
  -v "$DUMP_DIR_ABS:/dump" \
  "$PG_IMAGE" \
  bash -c '{
    echo "set session_replication_role = replica;";
    cat "/dump/$DUMP_NAME";
  } | psql "$PGURL" -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null'

# `__drizzle_migrations` is excluded from the dump, but its sequence is not, so the
# load leaves the counter wherever the source stood. Point it back at the rows the
# target actually holds, or the next migration collides with an existing id.
docker run --rm \
  -e PGURL="$TARGET_DATABASE_URL" \
  -e RESET_SEQUENCE="
    select setval(
      pg_get_serial_sequence('${DB_SCHEMA}.__drizzle_migrations', 'id'),
      coalesce((select max(id) from ${DB_SCHEMA}.__drizzle_migrations), 1),
      true
    )
  " \
  "$PG_IMAGE" \
  bash -c 'psql "$PGURL" -tAX -q -c "$RESET_SEQUENCE" > /dev/null'

echo "done. verify with scripts/ops/compare-database-contents.ts before switching over."
