# HOUSEBOT-061: Local End-to-End Smoke Tests for Billing Flow

## Summary

Add a pragmatic local smoke test that exercises the main billing path against a real database with deterministic assertions.

## Goals

- Provide `bun run test:e2e` for local pre-deploy confidence.
- Cover purchase ingestion, manual utility entry, and statement generation in one flow.
- Ensure smoke data is isolated and cleaned up automatically.

## Non-goals

- Full browser or Telegram API end-to-end automation.
- Running destructive write tests in the default CI quality matrix.
- Comprehensive scenario coverage for every finance edge case.

## Scope

- In: write-gated smoke script, docs, typed env for the smoke test, deterministic assertions, cleanup.
- Out: full staging environment orchestration.

## Interfaces and Contracts

- Command: `bun run test:e2e`
- Required env:
  - `DATABASE_URL`
  - `E2E_SMOKE_ALLOW_WRITE=true`
- Script behavior:
  - creates temporary household/member/cycle data
  - simulates Telegram topic purchase ingestion
  - simulates finance commands for rent, utilities, and statements
  - deletes created data in `finally`

## Domain Rules

- Use integer minor units only.
- Statement totals must match deterministic settlement behavior.
- Purchase-topic ingestion must not swallow non-purchase slash commands.

## Data Model Changes

- None.

## Security and Privacy

- Test writes are disabled unless `E2E_SMOKE_ALLOW_WRITE=true`.
- No production secrets are logged by the smoke script.

## Observability

- Script prints a single success line on pass.
- Failures surface assertion or runtime errors with non-zero exit code.

## Edge Cases and Failure Modes

- Missing `DATABASE_URL`: fail fast in env validation.
- Missing explicit write guard: fail fast before DB writes.
- Middleware ordering regression: smoke test should fail when commands stop emitting statements.

## Test Plan

- Unit: parser/topic candidate tests cover slash-command exclusion.
- Integration: `bun run test:e2e` against a migrated dev database.
- E2E: same smoke script verifies purchase ingestion -> statement -> recalculated statement after utility update.

## Acceptance Criteria

- [ ] `bun run test:e2e` executes locally with deterministic output.
- [ ] Purchase ingestion and utility updates are both covered in the same smoke flow.
- [ ] Docs explain required env and safety guard.

## Rollout Plan

- Keep the smoke test local-first.
- Consider adding an opt-in CI job later once a dedicated disposable database is available.
