# Migration Runbook

## Model

- Source of truth: Drizzle schema in `packages/db/src/schema.ts`
- Generated SQL migrations: `packages/db/drizzle/*.sql`
- Do not edit generated SQL manually unless required and reviewed.

## Local workflow (algorithm)

1. Change schema in `packages/db/src/schema.ts`.
2. Generate migration:

```bash
bun run db:generate
```

3. Review generated SQL in `packages/db/drizzle/`.
4. Validate migration metadata:

```bash
bun run db:check
```

5. Apply migration to target DB:

```bash
bun run db:migrate
```

6. Run quality gates:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

7. Commit schema + migration files together in one PR.

## CI behavior

- CI runs `bun run db:check` in parallel with other quality jobs.
- CI does not apply migrations to shared environments.

## CD behavior

- CD deploy runs migrations before deploy and now requires the `DATABASE_URL` GitHub secret.
- If `DATABASE_URL` is missing, CD fails fast instead of deploying schema-dependent code without migrations.

## Safety rules

- Prefer additive migrations first (new columns/tables) over destructive changes.
- For destructive changes, use two-step rollout:
  1. Backward-compatible deploy
  2. Data backfill/cutover
  3. Cleanup migration
- Never run `db:push` in production pipelines.

## Rollback notes

- If a migration fails mid-run, stop deploy and inspect `drizzle.__drizzle_migrations` state first.
- For additive migrations in v1, rollback by:
  1. Reverting application code to previous release.
  2. Leaving additive schema in place (safe default).
- For destructive migrations, require explicit rollback SQL script in the same PR before deploy approval.
- Keep one database backup/snapshot before production migration windows.
