# AGENTS.md

## Project

Household Telegram bot + mini app monorepo for shared rent/utilities/purchase accounting.

## Core stack

- Runtime/tooling: Bun
- Language: TypeScript (strict)
- Typecheck: tsgo (`@typescript/native-preview`)
- Lint: Oxlint
- Format: Oxfmt (no semicolons)
- Bot: grammY
- Mini app: SolidJS + Vite
- Data platform: Supabase (planned)
- Deploy: Cloud Run + Cloud Scheduler (planned)

## Architecture

Hexagonal architecture:

- `packages/domain`: pure business rules/value objects only
- `packages/application`: use-cases only
- `packages/ports`: interfaces for external boundaries
- `apps/*`: composition/wiring and delivery endpoints

Boundary rules:

- No framework/DB/HTTP imports in `packages/domain`
- `packages/application` must not import adapter implementations
- External SDK usage belongs outside domain/application core

## Money and accounting rules

- Never use floating-point money math
- Store amounts in minor units
- Deterministic split behavior only
- Persist raw parsed purchase text + confidence + parser mode

## Workflow

- Work from Linear tickets and linked specs in `docs/specs/`
- One ticket at a time, small commits
- Before implementation: re-check ticket/spec and assumptions
- Do not commit without explicit user approval
- Run CodeRabbit review before merge (`bun run review:coderabbit`)

## Communication

- Always respond to the user in English unless they explicitly ask for another language.
- Do not mirror the language of pasted messages, logs, or chat transcripts unless asked.

## Quality gates

Required before PR/merge:

- `bun run format:check`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`

## CI/CD

- CI workflow runs parallel quality jobs on push/PR to `main`
- CD workflow deploys on successful `main` CI or manual trigger
- Required CD secrets:
  - `GCP_PROJECT_ID`
  - `GCP_WORKLOAD_IDENTITY_PROVIDER`
  - `GCP_SERVICE_ACCOUNT`

## Docs as source of truth

- Roadmap: `docs/roadmap.md`
- Specs template: `docs/specs/README.md`
- ADRs: `docs/decisions/*`
- Runbooks: `docs/runbooks/*`
