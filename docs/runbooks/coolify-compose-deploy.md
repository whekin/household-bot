# Coolify Docker Compose Deployment

## Goal

Deploy `household-bot` on the Coolify VPS with its private PostgreSQL resource, while preserving cloud compatibility in the codebase.

## Why Coolify-first

Coolify already provides:

- Git-based deployments
- domains and TLS
- environment variable management
- Docker Compose deployment support

That makes it a better target than a hand-rolled VPS deploy workflow for this project.

## Deployment shape

Use `docker-compose.coolify.yml` as the production compose file in a Coolify Git-based Docker Compose application. Keep the root `docker-compose.yml` for local Docker smoke runs.

This compose file uses `build.context: .`, so Coolify must deploy it from a Git repository checkout. Do not paste it into a `Docker Compose Empty` service unless you also replace the `build` blocks with registry-backed `image` references.

The Coolify stack has three services:

- `bot` — Telegram webhook/API
- `miniapp` — static frontend container
- `scheduler` — periodic due-dispatch runner

Production data lives in the separate `household-postgres` PostgreSQL 17 Coolify resource. Keep it outside this Compose stack so application redeploys cannot replace its volume. The Compose application has **Connect To Predefined Network** enabled; `DATABASE_URL` uses the database resource's private internal URL. The old Supabase project was paused after the [database cutover](db-migration-to-coolify.md).

## Compose principles for Coolify

For Coolify Compose deployments:

- the compose file is the source of truth
- define environment variables inline with `${VAR}` placeholders
- let Coolify manage domains/proxying instead of bundling Caddy/Nginx reverse proxy for the public edge
- do not rely on external `env_file` paths on the host
- do not publish host ports for public services; assign domains to service port `8080` in Coolify

## Scheduler strategy

Runtime model:

- `bot` handles webhook/API traffic
- `scheduler` calls `http://bot:8080/jobs/dispatch-due` repeatedly through the internal Compose network
- both services build from `apps/bot/Dockerfile`, but `scheduler` overrides the command with `bun apps/bot/dist/scheduler-runner.js`
- `scheduler` overrides the bot image HTTP healthcheck because it is a worker process, not an HTTP server
- scheduled dispatch provider is `self-hosted`

## Migrations

The production `bot` command in `docker-compose.coolify.yml` runs `bun packages/db/dist/migrate.js` before starting the webhook server. Confirm the startup logs say `Migrations applied successfully!` after each deploy. A separate manual run is useful for diagnosis, but is not the normal production path.

Use the bot image/container environment because it contains the compiled migration runner and Drizzle migration files:

```sh
bun packages/db/dist/migrate.js
```

In Coolify, run this through the `bot` service terminal/command executor so `DATABASE_URL` and `DB_SCHEMA` come from the same runtime environment as the app.

If running locally against the Coolify compose file for validation, provide the required env vars and run:

```sh
docker compose -f docker-compose.coolify.yml run --rm bot bun packages/db/dist/migrate.js
```

## Domains

Public domains in production:

- `kojori-bot-api-coolify.whekin.dev` -> `bot:8080`
- `kojori-bot-miniapp-coolify.whekin.dev` -> `miniapp:80`

Coolify should manage the public routing/TLS for these services.

In Coolify's domain fields:

- Domains for `bot`: `https://kojori-bot-api-coolify.whekin.dev`
- Domains for `miniapp`: `https://kojori-bot-miniapp-coolify.whekin.dev`
- Domains for `scheduler`: leave blank

The bot listens on internal container port `8080`; the mini app's nginx listens on `80`. Coolify's saved domain mapping targets those ports without a public host-port mapping.

## Required Coolify variables

Core bot/runtime:

- `DATABASE_URL`
- `DB_SCHEMA` (default `public`)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_PATH`
- `MINI_APP_URL`
- `MINI_APP_ALLOWED_ORIGINS`
- `SCHEDULER_SHARED_SECRET`

Optional AI/runtime:

- `OPENAI_API_KEY`
- `ASSISTANT_MODEL`
- assistant timeout/rate-limit variables

Miniapp:

- `BOT_API_URL`

Scheduler:

- `SCHEDULER_POLL_INTERVAL_MS`
- `SCHEDULER_DUE_SCAN_LIMIT`

Expected production values:

```sh
MINI_APP_URL=https://kojori-bot-miniapp-coolify.whekin.dev
BOT_API_URL=https://kojori-bot-api-coolify.whekin.dev
MINI_APP_ALLOWED_ORIGINS=https://kojori-bot-miniapp-coolify.whekin.dev
TELEGRAM_WEBHOOK_PATH=/webhook/telegram
DB_SCHEMA=public
```

## Cloud compatibility rule

Keep these intact in the app/config layer even if Coolify becomes the main path:

- Cloud Run compatibility
- AWS compatibility
- existing cloud-specific scheduler env vars/adapters

The deployment target changes; the app should not become Coolify-only.

## Recommended rollout

1. Create a Coolify Application from this Git repository.
2. Select Docker Compose as the application build pack.
3. Set the compose file path to `docker-compose.coolify.yml`.
4. Fill all required variables in Coolify.
5. Assign domains to `bot:8080` and `miniapp:80`.
6. Enable **Connect To Predefined Network** so the Compose bot can reach the private PostgreSQL resource.
7. Deploy the stack and verify the bot's startup migration log.
8. Set the Telegram webhook:

```sh
export TELEGRAM_WEBHOOK_URL="https://kojori-bot-api-coolify.whekin.dev/webhook/telegram"
bun run ops:telegram:webhook set
bun run ops:telegram:webhook info
```

9. Run smoke checks:

```sh
export BOT_API_URL="https://kojori-bot-api-coolify.whekin.dev"
export MINI_APP_URL="https://kojori-bot-miniapp-coolify.whekin.dev"
export TELEGRAM_EXPECTED_WEBHOOK_URL="${BOT_API_URL}/webhook/telegram"
bun run ops:deploy:smoke
```

Manual checks:

- `GET https://kojori-bot-api-coolify.whekin.dev/healthz` returns `{ "ok": true }`
- `GET https://kojori-bot-miniapp-coolify.whekin.dev/health` succeeds
- unauthenticated `POST https://kojori-bot-api-coolify.whekin.dev/jobs/dispatch-due` returns `401`

## Redeploy

Coolify watches the repository and builds `docker-compose.coolify.yml` on the VPS itself, so a push
to `main` is the deploy. To redeploy a commit that is already pushed, use `Redeploy` on the Coolify
application page.

There is no CD workflow. One used to call Coolify's deploy webhook from GitHub Actions, but the
webhook stopped resolving and every run failed for weeks while Coolify kept deploying on its own, so
the workflow was removed rather than repaired. Former cloud deployment workflows stay archived under
`docs/archive/github-workflows/` in case GCP or AWS deployment needs to be restored later.

If a GitHub-triggered deploy is ever wanted again, it needs a fresh resource webhook URL and an API
token with deploy permission — the old `COOLIFY_WEBHOOK` and `COOLIFY_TOKEN` secrets on the
`Production` environment are unused and safe to delete.

## Notes for later

Possible future upgrades:

- add Codex/CodeRabbit review automation around PRs
- move migrations to a dedicated release/predeploy step
- codify Coolify resources with Terraform/Pulumi later if that still feels worth it
