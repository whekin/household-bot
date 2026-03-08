# HOUSEBOT-024: Repository Adapters for Application Ports

## Summary

Move persistence concerns behind explicit ports so application use-cases remain framework-free and bot delivery code stops querying Drizzle directly.

## Goals

- Define repository contracts in `packages/ports` for finance command workflows.
- Move concrete Drizzle persistence into an adapter package.
- Rewire bot finance commands to depend on application services instead of direct DB access.

## Non-goals

- Full persistence migration for every feature in one shot.
- Replacing Drizzle or Supabase.
- Changing finance behavior or settlement rules.

## Scope

- In: finance command repository ports, application service orchestration, Drizzle adapter, bot composition updates.
- Out: reminder scheduler adapters and mini app query adapters.

## Interfaces and Contracts

- Port: `FinanceRepository`
- Application service:
  - member lookup
  - open/close cycle
  - rent rule save
  - utility bill add
  - statement generation with persisted settlement snapshot
- Adapter: Drizzle-backed repository implementation bound to a household.

## Domain Rules

- Domain money and settlement logic stay in `packages/domain` and `packages/application`.
- Application may orchestrate repository calls but cannot import DB/schema modules.
- Bot command handlers may translate Telegram context to use-case inputs, but may not query DB directly.

## Data Model Changes

- None.

## Security and Privacy

- Authorization remains in bot delivery layer using household membership/admin data from the application service.
- No new secrets or data exposure paths.

## Observability

- Existing command-level success/error logging behavior remains unchanged.
- Statement persistence remains deterministic and idempotent per cycle snapshot replacement.

## Edge Cases and Failure Modes

- Missing cycle, rent rule, or members should still return deterministic user-facing failures.
- Adapter wiring mistakes should fail in typecheck/build, not at runtime.
- Middleware or bot delivery bugs must not bypass application-level repository boundaries.

## Test Plan

- Unit: application service tests with repository stubs.
- Integration: Drizzle adapter exercised through bot/e2e flows.
- E2E: billing smoke test continues to pass after the refactor.

## Acceptance Criteria

- [ ] `packages/application` imports ports, not concrete DB code.
- [ ] `apps/bot/src/finance-commands.ts` contains no Drizzle/schema access.
- [ ] Finance command behavior remains green in repo tests and smoke flow.

## Rollout Plan

- Introduce finance repository ports first.
- Keep purchase ingestion adapter migration as a follow-up if needed.
