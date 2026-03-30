# VPS Docker Compose Deployment Plan

## Goal

Make the VPS deployment path first-class without removing the existing Cloud Run / AWS paths.

Primary target:
- bot API on Docker Compose
- mini app on Docker Compose
- reverse proxy with HTTPS on the VPS
- scheduled reminder delivery without Cloud Tasks / Cloud Scheduler
- GitHub Actions CD that deploys to the VPS

Compatibility requirement:
- keep existing cloud deployment code and workflows available
- avoid deleting GCP/AWS-specific adapters unless they are clearly dead and isolated

## Deployment Shape

Recommended production services:
- `bot` - Bun runtime for Telegram webhook/API
- `miniapp` - static assets served behind reverse proxy
- `scheduler` - separate service that periodically triggers due scheduled dispatch processing
- `caddy` - TLS + reverse proxy for `bot.<domain>` and `app.<domain>`

Database:
- keep Supabase / managed Postgres external
- do not move Postgres onto the VPS in this phase

## Scheduler Replacement Strategy

Current app logic already stores scheduled dispatches in Postgres and uses provider adapters for one-shot execution.

For VPS:
1. Add a self-hosted scheduled dispatch provider.
2. Keep dispatch records in the database as before.
3. Add a due-dispatch scan endpoint/handler in the bot runtime.
4. Run a dedicated scheduler service in Compose that periodically triggers that scan.
5. Keep GCP Cloud Tasks and AWS EventBridge adapters intact for backward compatibility.

This keeps reminder behavior deterministic while removing dependency on cloud schedulers.

## Image / Runtime Plan

### Bot image
- keep multi-stage build
- build runtime entrypoints for:
  - bot server
  - scheduler runner
  - DB migrate command
- keep runtime image lean

### Mini app image
- keep static build + nginx/alpine runtime

### Reverse proxy image
- use an off-the-shelf slim image (Caddy)

## CD Plan

Add a separate GitHub Actions workflow for VPS deploy:
1. run on successful `main` CI and manual dispatch
2. build/push bot and miniapp images to GHCR
3. SSH into VPS
4. pull latest images
5. run DB migrations
6. restart Compose services
7. run smoke checks
8. sync Telegram webhook

Keep existing GCP and AWS workflows untouched.

## Secrets / Env Plan

Phase 1:
- keep runtime env files on the VPS outside the repo
- Compose loads env files from a deploy directory

Optional later upgrade:
- add 1Password-backed rendering or injection without changing app runtime contracts

Compatibility rule:
- do not remove existing env vars for GCP/AWS paths
- only add new VPS/self-hosted vars where needed

## Expected Repo Changes

### App/runtime
- add self-hosted scheduler adapter
- add due-dispatch scan support
- add scheduler runner entrypoint
- extend config parsing with VPS/self-hosted provider

### Docker / deploy
- add production compose file
- add Caddy config
- add VPS deploy helper scripts

### CI/CD
- add VPS deploy workflow
- keep `cd.yml` and `cd-aws.yml`

### Docs
- add VPS deployment runbook
- document required env files and domains

## Domain Assumption

Base domain: `whekin.dev`

Suggested hostnames:
- `household-bot.whekin.dev` for bot API / webhook
- `household.whekin.dev` for mini app

These can be adjusted later without changing the deployment shape.

## Rollout Order

1. Add docs/plan
2. Implement self-hosted scheduler path
3. Add production compose + reverse proxy config
4. Add VPS deploy scripts
5. Add GitHub Actions VPS CD
6. Validate builds/tests where practical
7. Push branch and open PR
