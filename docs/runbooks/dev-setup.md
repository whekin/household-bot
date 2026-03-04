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

## CI/CD

- CI runs in parallel matrix jobs on push/PR to `main`:
  - `format:check`, `lint`, `typecheck`, `test`, `build`
  - `terraform fmt -check`, `terraform validate`
- CD deploys on successful `main` CI completion (or manual dispatch).
- CD is enabled when GitHub secrets are configured:
  - `GCP_PROJECT_ID`
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT`

## IaC Runbook

- See `docs/runbooks/iac-terraform.md` for provisioning flow.
