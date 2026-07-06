# Coolify Docker Compose Deployment

## Goal

Deploy `household-bot` on a VPS that already runs Coolify, while keeping Supabase external and preserving cloud compatibility in the codebase.

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

Database stays external in Supabase / managed Postgres. Do not add a Postgres container to this stack unless the operational ownership model changes.

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

Run database migrations manually before or immediately after deployment, not from app startup.

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

Suggested public domains:

- `household-bot.whekin.dev` -> `bot:8080`
- `household.whekin.dev` -> `miniapp:80`

Coolify should manage the public routing/TLS for these services.

In Coolify's domain fields:

- Domains for `bot`: `https://household-bot.whekin.dev:8080`
- Domains for `miniapp`: `https://household.whekin.dev`
- Domains for `scheduler`: leave blank

The `:8080` suffix is only needed for the bot because it listens on container port `8080`.
The mini app uses nginx on container port `80`, so no port suffix is needed for its domain.

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
MINI_APP_URL=https://household.whekin.dev
BOT_API_URL=https://household-bot.whekin.dev
MINI_APP_ALLOWED_ORIGINS=https://household.whekin.dev
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
6. Deploy the stack.
7. Run the manual migration command in the `bot` service environment.
8. Set the Telegram webhook:

```sh
export TELEGRAM_WEBHOOK_URL="https://household-bot.whekin.dev/webhook/telegram"
bun run ops:telegram:webhook set
bun run ops:telegram:webhook info
```

9. Run smoke checks:

```sh
export BOT_API_URL="https://household-bot.whekin.dev"
export MINI_APP_URL="https://household.whekin.dev"
export TELEGRAM_EXPECTED_WEBHOOK_URL="${BOT_API_URL}/webhook/telegram"
bun run ops:deploy:smoke
```

Manual checks:

- `GET https://household-bot.whekin.dev/healthz` returns `{ "ok": true }`
- `GET https://household.whekin.dev/health` succeeds
- unauthenticated `POST https://household-bot.whekin.dev/jobs/dispatch-due` returns `401`

## GitHub Actions redeploy

Use `.github/workflows/cd-coolify.yml` to trigger a Coolify redeploy after `CI` passes on `main`.
The workflow also supports manual redeploys through GitHub Actions `Run workflow`.

Coolify is the only active CD workflow. Former cloud deployment workflows are archived under
`docs/archive/github-workflows/` so GitHub does not run them, but their contents remain available if
GCP or AWS deployment needs to be restored later.

Required GitHub environment secrets for `Production`:

- `COOLIFY_WEBHOOK` — Coolify resource deploy webhook URL from the application `Webhooks` page
- `COOLIFY_TOKEN` — Coolify API token with deploy permission

To redeploy immediately:

1. Ensure the target commit is pushed to `main`.
2. Open GitHub Actions.
3. Select `CD / Coolify`.
4. Click `Run workflow`.

The workflow only calls Coolify's deploy webhook. Coolify still pulls the Git repository and builds
`docker-compose.coolify.yml` on the VPS.

## Notes for later

Possible future upgrades:

- add Codex/CodeRabbit review automation around PRs
- move migrations to a dedicated release/predeploy step
- codify Coolify resources with Terraform/Pulumi later if that still feels worth it
