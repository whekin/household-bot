# Database Migration: Supabase Cloud → Coolify

## Production status (2026-09-23)

Cutover completed. The bot uses the private `household-postgres` PostgreSQL 17 resource, and the old Supabase Free project is **paused**, not deleted. The final stopped-source and restored-target fingerprint matched exactly: `37|3870|caf69c077364aaf82ca162421c01693d`. Bot startup migrations, API and mini-app health, Telegram webhook delivery, and scheduler database reads passed after the switch. The final owner-only local dump is `tmp/db-migration/cutover-2026-09-23T11-38-12-658Z.dump` (SHA-256 `852f807676127145fb99c23369ea70973a597744f9fb396d89341d1c04b14e0f`). Coolify's daily local backup with 30-day retention succeeded after cutover. No offsite S3 destination is configured yet.

## Goal

Move household data from hosted Supabase (`aws-1-eu-west-1.pooler.supabase.com`) to a Postgres you run in Coolify, next to the bot.

## What the app actually needs

The running app uses Supabase for Postgres only:

- no `@supabase/*` dependency anywhere in the workspace
- no auth, storage, realtime or edge functions
- no RLS policies or references to `auth.*` in the migrations under `packages/db/drizzle`
- the application schema is `public`; its migration history is in `__drizzle_migrations`

So the target is a plain `postgres:17` container. Supabase Studio is still available as an admin UI on top of it — see [Studio on plain Postgres](#studio-on-plain-postgres).

Co-locating the database with the bot also removes the per-query round trip to `eu-west-1`, which is a flat multiplier on every read the bot does.

## Model

The preferred private-network path uses a **custom-format dump of the `public` schema and data**. It includes `__drizzle_migrations`, so the new database receives the exact production schema and migration history. Coolify's built-in Import Backup can load it without making Postgres public. The bot's startup migration runner then checks for any newer migrations.

The existing `pg-dump-data.sh` and `pg-restore-data.sh` remain an alternative when the target is directly reachable: run repository migrations first, then transfer data only. Do not mix the two restore methods.

`pg_dump` and `psql` run inside a `postgres:17` container. Use a client major version at least as new as the source server. A full local restore rehearsal and matching table counts/content fingerprints are required before cutover.

## Prerequisites

- Docker running locally
- A **direct or session** connection string for Supabase on port `5432`. The app's transaction-pooler URL on `6543` is unsuitable for `pg_dump`; remove its app-only `?pgbouncer=true` parameter as well.
- A private PostgreSQL 17 resource in the same Coolify destination as the bot. Keep **Make it publicly available** off.
- Local Docker and an ignored, private `tmp/db-migration` directory for the temporary backup.

## Step 0 — pre-flight

Check the server version so `PG_IMAGE` is at least that high, and see how much data there is:

```bash
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" postgres:17 psql "$PGURL" -tAX -c "select version()"
```

```bash
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" postgres:17 psql "$PGURL" -tAX -c "select pg_size_pretty(pg_database_size(current_database()))"
```

## Step 1 — provision the target

In the production Coolify environment, add a standalone PostgreSQL 17 resource on the default `coolify` destination. Verify its persistent volume and internal URL; leave its public port disabled. The bot is a Docker Compose application, so **Configuration → Advanced → Connect To Predefined Network** must be enabled before the bot can reach this separate private resource. Apply that setting at cutover with the app redeploy.

## Step 2 — rehearse locally (no downtime, no risk)

Test the existing data-only path into a throwaway container. Nothing writes to the source.

```bash
docker run -d --name pgdrill -e POSTGRES_PASSWORD=pg -p 127.0.0.1:55433:5432 postgres:17
```

```bash
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" ./scripts/ops/pg-dump-data.sh
```

```bash
DATABASE_URL='postgres://postgres:pg@127.0.0.1:55433/postgres' bun run db:migrate
```

```bash
TARGET_DATABASE_URL='postgres://postgres:pg@host.docker.internal:55433/postgres' DUMP_PATH=./tmp/db-migration/<dump>.sql ./scripts/ops/pg-restore-data.sh
```

```bash
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" TARGET_DATABASE_URL='postgres://postgres:pg@127.0.0.1:55433/postgres' bun run ops:db:compare
```

The comparison checks both row counts and row-content hashes. A live source can change after the dump, causing an expected mismatch; inspect the table and timestamps rather than declaring the backup corrupt.

Also rehearse the Coolify import path. Create a custom-format dump, keeping its file owner-only:

```bash
mkdir -p tmp/db-migration
chmod 700 tmp/db-migration
DUMP_NAME="full-$(date +%Y%m%d-%H%M%S).dump"
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" -e DUMP_NAME="$DUMP_NAME" \
  -v "$PWD/tmp/db-migration:/dump" postgres:17 sh -c \
  'pg_dump "$PGURL" --format=custom --schema=public --no-owner --no-privileges --file="/dump/$DUMP_NAME"'
chmod 600 "tmp/db-migration/$DUMP_NAME"
shasum -a 256 "tmp/db-migration/$DUMP_NAME"
```

Restore it into a second empty local database and compare. A new Postgres database already contains a `public` schema, so `--clean --if-exists` is necessary.

```bash
docker exec pgdrill createdb -U postgres full_restore
docker run --rm \
  -e PGURL='postgres://postgres:pg@host.docker.internal:55433/full_restore' \
  -e DUMP_NAME="$DUMP_NAME" -v "$PWD/tmp/db-migration:/dump:ro" \
  postgres:17 sh -c \
  'pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-acl -d "$PGURL" "/dump/$DUMP_NAME"'
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" \
  TARGET_DATABASE_URL='postgres://postgres:pg@127.0.0.1:55433/full_restore' \
  bun run ops:db:compare
docker rm -f pgdrill
```

## Step 3 — cutover

Writes that land in Supabase after the final dump are lost, so stop **both bot and scheduler** first. Budget for the actual transfer path: the 0.37 MB Coolify browser upload took much longer than expected during this cutover. The Coolify Compose application's Stop control stops all three services, including the mini app.

1. Remove the Telegram webhook so updates queue on Telegram's side, then stop the Coolify application. Confirm the bot and scheduler are stopped:

```bash
bun --env-file=.env scripts/ops/telegram-webhook.ts delete
```

2. Take a **fresh** custom-format source dump using the command from Step 2 through the direct/session URL. Store it under ignored `tmp/db-migration` with file mode `0600` and record its SHA-256 checksum. Do not reuse the rehearsal dump.

3. Upload that dump to the private Coolify database under **Configuration → Import Backup → Restore from File**. Use this tested Custom Import Command:

```bash
pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-acl -U $POSTGRES_USER -d ${POSTGRES_DB:-${POSTGRES_USER:-postgres}}
```

4. Verify the restore output has exit code 0. Compare the count and content fingerprint from `scripts/ops/database-fingerprint.sql` on both databases while Supabase writes remain stopped. Check `__drizzle_migrations` count separately. The one-line fingerprint result is `table_count|row_count|content_fingerprint`; it must match exactly. The local comparison script can also be used if the target is reachable through a private tunnel.

5. In the Coolify Compose app, enable **Connect To Predefined Network**, set its `DATABASE_URL` to the database resource's **internal** URL, and redeploy. The bot starts by running the repository migration runner. Verify all services are healthy and the bot can read household data.

6. Restore the webhook and run the smoke check:

```bash
bun --env-file=.env scripts/ops/telegram-webhook.ts set
bun --env-file=.env scripts/ops/deploy-smoke.ts
```

7. Check an authenticated mini-app dashboard and a real, already-authorized bot flow. Confirm any new row lands only in Coolify. Record the cutover time and keep Supabase unchanged for rollback analysis.

## Step 4 — after the switch

- **Prepared statements.** `packages/db/src/client.ts` passes `prepare: false` because Supabase's transaction pooler cannot prepare. A direct Postgres connection can, and it saves a parse per query — flip it once nothing is behind PgBouncer.
- **Pool size.** `DB_POOL_MAX` (default 10) is now bounded by your own `max_connections`, not by a Supabase plan.
- **Backups are yours now.** Configure Coolify's scheduled PostgreSQL backups with retention and an offsite S3 destination. A local persistent volume and local backups share the same VPS failure domain. Restore a backup into a throwaway container occasionally to prove it works. Keep the final local cutover dump off the VPS until offsite backups are verified.
- The Supabase Free project is paused and remains a rollback source. New Coolify writes are not replicated back to it.

## Database administration

The production PostgreSQL resource stays private. Its Coolify **Terminal** provides immediate remote `psql` access without publishing port 5432.

For a persistent web UI, prefer a separate Coolify service on the same predefined Docker network. [Drizzle Gateway](https://orm.drizzle.team/drizzle-studio/overview) is the closest lightweight fit for this Drizzle-based project: one container, a persistent configuration volume, table/SQL editors, and a master password. Coolify also offers [CloudBeaver and pgAdmin templates](https://coolify.io/docs/services/all). Give the admin UI its own authenticated HTTPS entry point; keep PostgreSQL's public port disabled. A dedicated database role is preferable to handing the UI the production `postgres` superuser credential.

Supabase Studio **can** use an existing PostgreSQL through `postgres-meta`, but the old two-container example was incomplete and pinned to 2025 images, so it has been removed. The [current Supabase self-hosted Compose file](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml) configures Studio with additional Supabase services and environment; [Studio's own README](https://github.com/supabase/supabase/blob/master/apps/studio/README.md) says self-hosted features are limited to database-oriented screens. A standalone Studio plus `postgres-meta` would need version pinning, extra configuration, and a separate authentication layer. Do not deploy the full Supabase template over the existing plain PostgreSQL volume merely to get its UI.

For local occasional use, this repository already has `bun run db:studio`; it needs a private connection path from the developer machine. [Drizzle documents](https://orm.drizzle.team/docs/drizzle-kit-studio) that this command is for local development, while Gateway is the deployable server version. To use a desktop SQL client remotely, establish a verified SSH tunnel or private VPN path; [Coolify's public database proxy](https://coolify.io/docs/databases/) is available but exposes a PostgreSQL port and should be firewall restricted with TLS if chosen. The local `.env` still points at paused Supabase and must not be reused for new production writes.

## Rollback

Until `DATABASE_URL` is switched, there is nothing to roll back — the source is untouched and read-only throughout.

After the switch, a simple URL rollback is clean only before any new write reaches Coolify. Otherwise reconcile or reverse-migrate the new writes first; do not silently discard them.

## Gotchas

| Symptom                                             | Cause                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pg_dump: error: ... unsupported startup parameter` | Dumping through the transaction pooler (`:6543`). Use the session/direct connection on `:5432`.                   |
| `server version mismatch`                           | The `postgres:*` image is older than the source server. Raise `PG_IMAGE`.                                         |
| Restore fails on a foreign key                      | Something bypassed `pg-restore-data.sh`; the load needs `session_replication_role = replica`.                     |
| Restore script refuses to run                       | The target already holds rows. Drop the schema, re-run `db:migrate`, load again.                                  |
| Next deploy's migration fails on a duplicate id     | `__drizzle_migrations` sequence left behind by a manual load. The restore script resets it; re-run that step.     |
| Row counts match but the bot 500s                   | `DB_SCHEMA` differs between environments. The dump is schema-qualified; both sides must use the same schema name. |
