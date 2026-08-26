# Database Migration: Supabase Cloud → Coolify

## Goal

Move household data from hosted Supabase (`aws-1-eu-west-1.pooler.supabase.com`) to a Postgres you run in Coolify, next to the bot.

## What the app actually needs

Nothing from Supabase except Postgres:

- no `@supabase/*` dependency anywhere in the workspace
- no auth, storage, realtime or edge functions
- no RLS policies, no references to `auth.*` in the 44 migrations under `packages/db/drizzle`
- schema is `public`, 34 tables, all UUID primary keys — the only sequence in the database belongs to `__drizzle_migrations`

So the target is a plain `postgres:17` container. Supabase Studio is still available as an admin UI on top of it — see [Studio on plain Postgres](#studio-on-plain-postgres).

Co-locating the database with the bot also removes the per-query round trip to `eu-west-1`, which is a flat multiplier on every read the bot does.

## Model

- The **schema** comes from drizzle migrations, run against the new database. It is never dumped.
- Only **data** is copied, with `pg_dump --data-only`.
- Both databases are compared table by table before anything is switched over.

`pg_dump` and `psql` run inside a `postgres:17` container, so the client is never older than the server and nothing has to be installed locally.

## Prerequisites

- Docker running locally
- A **direct or session** connection string for the Supabase database (port `5432`). The transaction pooler on `6543` cannot serve `pg_dump`.
- A Postgres service in Coolify, reachable from your machine for the load (Coolify can expose it temporarily, or run the load from the VPS)

## Step 0 — pre-flight

Check the server version so `PG_IMAGE` is at least that high, and see how much data there is:

```bash
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" postgres:17 psql "$PGURL" -tAX -c "select version()"
```

```bash
docker run --rm -e PGURL="$SOURCE_DATABASE_URL" postgres:17 psql "$PGURL" -tAX -c "select pg_size_pretty(pg_database_size(current_database()))"
```

## Step 1 — provision the target

In Coolify: add a PostgreSQL 17 database, give it a persistent volume, and note the connection string. Keep it on the internal network; expose it publicly only for the duration of the load, if at all.

## Step 2 — rehearse locally (no downtime, no risk)

Run the whole procedure into a throwaway container first. Nothing writes to the source.

```bash
docker run -d --name pgdrill -e POSTGRES_PASSWORD=pg -p 55433:5432 postgres:17
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

The comparison prints every table with both row counts and exits non-zero on any difference. Tear the drill container down with `docker rm -f pgdrill`.

## Step 3 — cutover

Writes that land in the old database after the dump are lost, so the bot stops first. Budget a few minutes.

1. Stop the bot in Coolify (stop the `bot` service; the mini app can stay up, it only reads through the bot).
2. Remove the Telegram webhook so updates queue on Telegram's side instead of erroring:

```bash
bun run ops:telegram:webhook delete
```

3. Dump the source:

```bash
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" ./scripts/ops/pg-dump-data.sh
```

4. Migrate the Coolify database:

```bash
DATABASE_URL="$TARGET_DATABASE_URL" bun run db:migrate
```

5. Load the data:

```bash
TARGET_DATABASE_URL="$TARGET_DATABASE_URL" DUMP_PATH=./tmp/db-migration/<dump>.sql ./scripts/ops/pg-restore-data.sh
```

6. Compare:

```bash
SOURCE_DATABASE_URL="$SOURCE_DATABASE_URL" TARGET_DATABASE_URL="$TARGET_DATABASE_URL" bun run ops:db:compare
```

7. Point `DATABASE_URL` in the Coolify stack at the new database, restart the bot, restore the webhook with `bun run ops:telegram:webhook set`, and run the smoke check:

```bash
bun run ops:deploy:smoke
```

8. Send one real payment through the mini app and confirm the row lands in the new database.

## Step 4 — after the switch

- **Prepared statements.** `packages/db/src/client.ts` passes `prepare: false` because Supabase's transaction pooler cannot prepare. A direct Postgres connection can, and it saves a parse per query — flip it once nothing is behind PgBouncer.
- **Pool size.** `DB_POOL_MAX` (default 10) is now bounded by your own `max_connections`, not by a Supabase plan.
- **Backups are yours now.** Supabase was taking them for you. Add a scheduled `pg_dump` (the dump script works unchanged against the new URL) plus a Coolify volume snapshot, and restore one into a throwaway container occasionally to prove it works.
- Keep the Supabase project around, read-only, until you trust the new one.

## Studio on plain Postgres

Supabase Studio runs against any Postgres through `postgres-meta`. Two extra containers, no auth/kong/realtime:

```yaml
services:
  postgres-meta:
    image: supabase/postgres-meta:v0.84.2
    environment:
      PG_META_PORT: '8080'
      PG_META_DB_HOST: postgres
      PG_META_DB_PORT: '5432'
      PG_META_DB_NAME: ${POSTGRES_DB}
      PG_META_DB_USER: ${POSTGRES_USER}
      PG_META_DB_PASSWORD: ${POSTGRES_PASSWORD}
    restart: unless-stopped

  studio:
    image: supabase/studio:20250224-d10db0f
    environment:
      STUDIO_PG_META_URL: http://postgres-meta:8080
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      DEFAULT_ORGANIZATION_NAME: household
      DEFAULT_PROJECT_NAME: household
    restart: unless-stopped
```

**Studio has no login of its own.** Whoever reaches it has full SQL access to the household data. Put it behind Coolify's basic auth or keep it off the public internet and reach it through a tunnel. `bun run db:studio` (drizzle-kit) is the zero-infrastructure alternative when you only want to browse rows.

## Rollback

Until `DATABASE_URL` is switched, there is nothing to roll back — the source is untouched and read-only throughout.

After the switch, roll back by pointing `DATABASE_URL` at Supabase again and restarting. Anything written to the new database in the meantime does not exist in Supabase, so this is only clean if you catch the problem immediately; otherwise dump the new database and load it back the same way.

## Gotchas

| Symptom                                             | Cause                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pg_dump: error: ... unsupported startup parameter` | Dumping through the transaction pooler (`:6543`). Use the session/direct connection on `:5432`.                   |
| `server version mismatch`                           | The `postgres:*` image is older than the source server. Raise `PG_IMAGE`.                                         |
| Restore fails on a foreign key                      | Something bypassed `pg-restore-data.sh`; the load needs `session_replication_role = replica`.                     |
| Restore script refuses to run                       | The target already holds rows. Drop the schema, re-run `db:migrate`, load again.                                  |
| Next deploy's migration fails on a duplicate id     | `__drizzle_migrations` sequence left behind by a manual load. The restore script resets it; re-run that step.     |
| Row counts match but the bot 500s                   | `DB_SCHEMA` differs between environments. The dump is schema-qualified; both sides must use the same schema name. |
