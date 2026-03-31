# Coolify Docker Compose Deployment Plan

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

Use a Docker Compose deployment in Coolify with three services:

- `bot` — Telegram webhook/API
- `miniapp` — static frontend container
- `scheduler` — periodic due-dispatch runner

Database stays external:

- Supabase / managed Postgres

## Compose principles for Coolify

For Coolify Compose deployments:

- the compose file is the source of truth
- define environment variables inline with `${VAR}` placeholders
- let Coolify manage domains/proxying instead of bundling Caddy/Nginx reverse proxy for the public edge
- do not rely on external `env_file` paths on the host

## Scheduler strategy

Keep the self-hosted scheduled dispatch provider introduced in this PR.

Runtime model:

- `bot` handles webhook/API traffic
- `scheduler` calls the internal due-dispatch endpoint repeatedly
- both services share the same app image build but run different commands

## Migrations

For the first Coolify version, run DB migrations from the bot startup command before the server starts.

This is intentionally pragmatic:

- no extra one-off deploy script is required
- no host SSH deploy step is required
- drizzle migrations are idempotent enough for single-service startup usage here

If the deployment setup matures later, split migrations into a dedicated release/predeploy step.

## Domains

Suggested public domains:

- `household-bot.whekin.dev` -> `bot`
- `household.whekin.dev` -> `miniapp`

Coolify should manage the public routing/TLS for these services.

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
- `SCHEDULED_DISPATCH_PROVIDER` (`self-hosted`)

Optional AI/runtime:

- `OPENAI_API_KEY`
- `PURCHASE_PARSER_MODEL`
- `ASSISTANT_MODEL`
- `TOPIC_PROCESSOR_MODEL`
- assistant timeout/rate-limit variables

Miniapp:

- `BOT_API_URL`

Scheduler:

- `SCHEDULER_POLL_INTERVAL_MS`
- `SCHEDULER_DUE_SCAN_LIMIT`

## Cloud compatibility rule

Keep these intact in the app/config layer even if Coolify becomes the main path:

- Cloud Run compatibility
- AWS compatibility
- existing cloud-specific scheduler env vars/adapters

The deployment target changes; the app should not become Coolify-only.

## Recommended rollout

1. Add Coolify compose file
2. Remove VPS-specific deploy glue from this PR
3. Create a Coolify Docker Compose app from the repo
4. Fill required variables in Coolify UI
5. Assign domains to `bot` and `miniapp`
6. Deploy and verify webhook + miniapp + scheduler behavior

## Notes for later

Possible future upgrades:

- add Codex/CodeRabbit review automation around PRs
- move migrations to a dedicated release step
- codify Coolify resources with Terraform/Pulumi later if that still feels worth it
