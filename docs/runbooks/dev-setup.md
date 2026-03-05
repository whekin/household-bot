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
bun run infra:fmt:check
bun run infra:validate
```

## App commands

```bash
bun run dev:bot
bun run dev:miniapp
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
- Migration workflow is documented in `docs/runbooks/migrations.md`.

## CI/CD

- CI runs in parallel matrix jobs on push/PR to `main`:
  - `format:check`, `lint`, `typecheck`, `test`, `build`
  - `terraform fmt -check`, `terraform validate`
- CD deploys on successful `main` CI completion (or manual dispatch).
- CD is enabled when GitHub secrets are configured:
  - `GCP_PROJECT_ID`
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT`
  - optional for automated migrations: `DATABASE_URL`

## IaC Runbook

- See `docs/runbooks/iac-terraform.md` for provisioning flow.
