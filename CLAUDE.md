# CLAUDE.md

## Project

Household Telegram bot + mini app monorepo for shared rent/utilities/purchase accounting.

## Project phase

- Current phase: `pre-1.0`
- Optimize for clarity, cohesion, and codebase freshness over backward compatibility
- Remove legacy fields, tables, env vars, code paths, and transitional structures by default unless the user explicitly asks to preserve them
- When implementing new features, it is acceptable to refactor or delete nearby obsolete code so the resulting system stays small and coherent

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
- Use pre-commit and pre-push hooks as the default validation path
- Run manual checks selectively for targeted validation or when hooks do not cover the relevant risk

## Commit conventions

Follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Scopes: `miniapp`, `bot`, `domain`, `application`, `db`

## Communication

- Always respond in English unless explicitly asked otherwise
- Do not mirror the language of pasted messages, logs, or chat transcripts

## Quality gates

Required before PR/merge:

- `bun run format:check`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Docs

- Roadmap: `docs/roadmap.md`
- Specs template: `docs/specs/README.md`
- ADRs: `docs/decisions/*`
- Runbooks: `docs/runbooks/*`
