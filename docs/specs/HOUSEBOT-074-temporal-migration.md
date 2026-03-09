# HOUSEBOT-074 Temporal Migration

## Goal

Move runtime time handling from ad-hoc `Date` usage to `Temporal` via `@js-temporal/polyfill`.

## Why

- Bun does not provide native `Temporal` yet, so the polyfill is the safe path.
- The bot has already had production failures caused by `Date` values crossing Bun/Postgres boundaries inconsistently.
- Time handling should be explicit and deterministic at adapter boundaries.

## Slice 1

- Add shared Temporal helpers in `@household/domain`
- Migrate anonymous feedback service and repository
- Migrate Telegram pending-action expiry handling
- Migrate mini app auth timestamp verification

## Boundary Rules

- Business/application code uses `Temporal.Instant` instead of `Date`
- Database adapters convert `Temporal.Instant` to SQL-compatible values on write
- Database adapters normalize string/`Date` timestamp values back to `Temporal.Instant` on read
- Telegram epoch timestamps remain numeric seconds at the API edge

## Non-goals

- Full repo-wide `Date` removal in one change
- Database schema changes
- Billing-period model replacement

## Follow-up Slices

- Finance command service and finance repository date handling
- Purchase ingestion timestamps
- Reminder job scheduling timestamps
- Test helpers that still construct `Date` values for untouched paths

## Acceptance

- No raw `Date` values cross the anonymous-feedback, pending-action, or mini app auth application boundaries
- `bun run typecheck`
- `bun run test`
- `bun run build`
