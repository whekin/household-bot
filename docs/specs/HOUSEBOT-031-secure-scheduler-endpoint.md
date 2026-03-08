# HOUSEBOT-031: Secure Scheduler Endpoint and Idempotent Reminder Dispatch

## Summary

Add authenticated reminder job endpoints to the bot runtime with deterministic deduplication and dry-run support.

## Goals

- Accept reminder job calls through dedicated HTTP endpoints.
- Reject unauthorized or malformed scheduler requests.
- Prevent duplicate reminder dispatch for the same household, period, and reminder type.
- Emit structured outcomes for local validation and future monitoring.

## Non-goals

- Full Cloud Scheduler IaC setup.
- Final Telegram reminder copy or topic routing.
- OIDC verification in v1 of this runtime slice.

## Scope

- In: shared-secret auth, request validation, dry-run mode, dedupe persistence, structured logs.
- Out: live Telegram send integration and scheduler provisioning.

## Interfaces and Contracts

- Endpoint family: `/jobs/reminder/<type>`
- Allowed types:
  - `utilities`
  - `rent-warning`
  - `rent-due`
- Request body:
  - `period?: YYYY-MM`
  - `jobId?: string`
  - `dryRun?: boolean`
- Auth:
  - `x-household-scheduler-secret: <secret>` or `Authorization: Bearer <secret>`

## Domain Rules

- Dedupe key format: `<period>:<reminderType>`
- Persistence uniqueness remains household-scoped.
- `dryRun=true` never persists a dispatch claim.

## Data Model Changes

- None. Reuse `processed_bot_messages` as the idempotency ledger for scheduler reminder claims.

## Security and Privacy

- Scheduler routes are unavailable unless `SCHEDULER_SHARED_SECRET` is configured.
- Unauthorized callers receive `401`.
- Request errors return `400` without leaking secrets.

## Observability

- Successful and failed job handling emits structured JSON logs.
- Log payload includes:
  - `jobId`
  - `dedupeKey`
  - `outcome`
  - `reminderType`
  - `period`

## Edge Cases and Failure Modes

- Empty body defaults period to the current UTC billing month.
- Invalid period format is rejected.
- Replayed jobs return `duplicate` without a second dispatch claim.

## Test Plan

- Unit: reminder job service dry-run and dedupe results.
- Integration-ish: HTTP handler auth, route validation, and response payloads.

## Acceptance Criteria

- [ ] Unauthorized scheduler requests are rejected.
- [ ] Duplicate scheduler calls return a deterministic duplicate outcome.
- [ ] Dry-run mode skips persistence and still returns a structured payload.
- [ ] Logs include `jobId`, `dedupeKey`, and outcome.
