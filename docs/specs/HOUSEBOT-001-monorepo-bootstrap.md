# HOUSEBOT-001: Monorepo Bootstrap and Quality Gates

## Summary

Initialize the repository as a Bun workspace monorepo with strict TypeScript, Oxlint, CI quality gates, and architecture-oriented package layout.

## Goals

- Establish baseline folder structure for hexagonal architecture.
- Add root scripts for lint, typecheck, test, and build.
- Enforce no-semicolon formatting style and strict linting.
- Ensure CI runs on every push/PR.

## Non-goals

- Implement business logic.
- Implement Telegram handlers.
- Create production cloud resources.

## Scope

- In: repo skeleton, workspace config, root tooling config, CI workflow.
- Out: feature code, database schema, external service integration.

## Interfaces and Contracts

- Root scripts exposed via `package.json`:
  - `lint`
  - `typecheck`
  - `test`
  - `build`
- Workspace packages must compile under shared TS config.

## Architecture Constraints

- Workspace must include:
  - `apps/bot`
  - `apps/miniapp`
  - `packages/domain`
  - `packages/application`
  - `packages/ports`
  - `packages/contracts`
  - `packages/observability`
- No cross-import from domain to adapters/apps.

## File Plan

- Root:
  - `package.json`
  - `bunfig.toml`
  - `tsconfig.base.json`
  - `oxlint.json`
  - `.editorconfig`
  - `.gitignore`
- CI:
  - `.github/workflows/ci.yml`
- Workspace placeholders:
  - `apps/bot/src/index.ts`
  - `apps/miniapp/src/main.tsx`
  - `packages/*/src/index.ts`

## Security and Safety

- No secrets in repo.
- Add `.env.example` templates only.
- CI must fail on type/lint/test failure.

## Test Plan

- Unit: not applicable in this ticket.
- Integration: not applicable.
- Validation checks:
  - Workspace install succeeds.
  - All root scripts run locally.
  - CI workflow executes all checks.

## Acceptance Criteria

- [ ] Bun workspace initialized with declared workspaces.
- [ ] Oxlint config present and root lint script works.
- [ ] TypeScript strict base config is shared across workspaces.
- [ ] CI workflow runs lint, typecheck, test, build.
- [ ] Placeholder apps/packages compile.
- [ ] Docs updated with local bootstrap commands.

## Rollout Plan

- Merge to default branch.
- Use as mandatory baseline for all subsequent tickets.
