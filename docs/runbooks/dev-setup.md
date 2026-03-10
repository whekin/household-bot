# Development Setup

## Requirements

- Bun 1.3+
- Node.js 22+
- Terraform 1.8+ (for IaC checks/plans)

## First-time setup

```bash
bun install
```

## Workspace commands

```bash
bun run lint
bun run lint:fix
bun run format
bun run format:check
bun run typecheck
bun run test
bun run build
bun run db:generate
bun run db:check
bun run db:migrate
bun run db:seed
bun run ops:telegram:webhook info
bun run ops:deploy:smoke
bun run infra:fmt:check
bun run infra:validate
```

## App commands

```bash
bun run dev:bot
bun run dev:miniapp
```

## Docker smoke commands

```bash
bun run docker:build
bun run docker:smoke
```

## Review commands

```bash
bun run review:coderabbit
```

## Notes

- Type checking uses `tsgo` (`@typescript/native-preview`).
- Linting uses `oxlint`.
- Formatting uses `oxfmt` with no-semicolon style.
- AI review uses CodeRabbit CLI in `--prompt-only` mode against `main`.
- Drizzle config is in `packages/db/drizzle.config.ts`.
- Typed environment validation lives in `packages/config/src/env.ts`.
- Copy `.env.example` to `.env` before running app/database commands.
- `bun run db:seed` refreshes the committed fixture household and is destructive for previously seeded fixture rows.
- Local bot feature flags come from env presence:
  - finance commands require `DATABASE_URL` plus household setup in Telegram via `/setup`
  - purchase ingestion requires `DATABASE_URL` plus a bound purchase topic via `/bind_purchase_topic`
  - anonymous feedback requires `DATABASE_URL` plus a bound feedback topic via `/bind_feedback_topic`
  - reminders require `DATABASE_URL` plus `SCHEDULER_SHARED_SECRET` or `SCHEDULER_OIDC_ALLOWED_EMAILS`
    and optionally use a dedicated reminders topic via `/bind_reminders_topic`
  - mini app CORS can be constrained with `MINI_APP_ALLOWED_ORIGINS`
- Migration workflow is documented in `docs/runbooks/migrations.md`.
- Destructive dev reset guidance is documented in `docs/runbooks/dev-reset.md`.
- First deploy flow is documented in `docs/runbooks/first-deploy.md`.

## CI/CD

- CI runs in parallel matrix jobs on push/PR to `main`:
  - `format:check`, `lint`, `typecheck`, `test`, `build`
  - `terraform fmt -check`, `terraform validate`
  - docker image builds for `apps/bot` and `apps/miniapp`
- CD deploys on successful `main` CI completion (or manual dispatch).
- CD is enabled when GitHub secrets are configured:
  - `GCP_PROJECT_ID`
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT`
  - `DATABASE_URL`
- Optional GitHub variables for deploy:
  - `GCP_REGION` (default `europe-west1`)
  - `ARTIFACT_REPOSITORY` (default `household-bot`)
  - `CLOUD_RUN_SERVICE_BOT` (default `household-dev-bot-api`)
  - `CLOUD_RUN_SERVICE_MINI` (default `household-dev-mini-app`)

## IaC Runbook

- See `docs/runbooks/iac-terraform.md` for provisioning flow.
