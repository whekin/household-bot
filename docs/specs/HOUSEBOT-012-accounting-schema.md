# HOUSEBOT-012: V1 Accounting Schema

## Summary

Define and migrate a production-ready accounting schema for household rent/utilities/purchases and settlement snapshots.

## Goals

- Support all v1 finance flows in database form.
- Enforce idempotency constraints for Telegram message ingestion.
- Store all monetary values in minor integer units.
- Provide local seed fixtures for fast end-to-end development.

## Non-goals

- Bot command implementation.
- Settlement algorithm implementation.

## Scope

- In: Drizzle schema + generated SQL migration + seed script + runbook update.
- Out: adapter repositories and service handlers.

## Interfaces and Contracts

Tables covered:

- `households`
- `members`
- `billing_cycles`
- `rent_rules`
- `utility_bills`
- `presence_overrides`
- `purchase_entries`
- `processed_bot_messages`
- `settlements`
- `settlement_lines`

## Domain Rules

- Minor-unit integer money only (`bigint` columns)
- Deterministic one-cycle settlement snapshot (`settlements.cycle_id` unique)
- Message idempotency enforced via unique source message keys

## Data Model Changes

- Add new finance tables and indexes for read/write paths.
- Add unique indexes for idempotency and period uniqueness.
- Preserve existing household/member table shape.

## Security and Privacy

- Store internal member IDs instead of personal attributes in finance tables.
- Keep raw purchase text for audit/parser debugging only.

## Observability

- `processed_bot_messages` and settlement metadata provide traceability.

## Edge Cases and Failure Modes

- Duplicate message ingestion attempts.
- Missing active cycle when writing purchases/bills.
- Partial fixture seed runs.

## Test Plan

- Generate and check migration metadata.
- Typecheck db package.
- Execute seed script on migrated database.

## Acceptance Criteria

- [ ] `bun run db:generate` produces migration SQL for schema updates.
- [ ] `bun run db:check` passes.
- [ ] Schema supports v1 rent/utilities/purchase/settlement workflows.
- [ ] Idempotency indexes exist for Telegram ingestion.
- [ ] Migration runbook includes rollback notes.

## Rollout Plan

- Apply migration in dev, run seed, validate queryability.
- Promote migration through CI/CD pipeline before production cutover.
