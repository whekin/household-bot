# HOUSEBOT-004: Reminders and Scheduler

## Summary

Schedule and deliver household billing reminders to dedicated Telegram topics.

## Goals

- Automate utility and rent reminders on configured dates.
- Ensure idempotent sends and reliable retries.
- Keep scheduling externalized via Cloud Scheduler.

## Non-goals

- Dynamic natural-language reminder editing.
- Per-user DM reminders in v1.

## Scope

- In: scheduler endpoints, reminder generation, send guards, per-household reminder eligibility.
- Out: full statement rendering details.

## Interfaces and Contracts

- HTTP endpoints triggered by Cloud Scheduler:
  - `/jobs/reminder/utilities`
  - `/jobs/reminder/rent-warning`
  - `/jobs/reminder/rent-due`
- Job payload includes cycle and household references.

## Domain Rules

- Utilities reminder target: household-configured utilities reminder day.
- Rent warning target: household-configured rent warning day.
- Rent due target: household-configured rent due day.
- Duplicate-send guard keyed by household + cycle + reminder type.
- Scheduler should run on a daily cadence and let the application decide which households are due today.

## Data Model Changes

- `reminder_dispatch_log`:
  - `household_id`
  - `billing_cycle`
  - `reminder_type`
  - `sent_at`
  - `telegram_message_id`

## Security and Privacy

- Scheduler endpoints protected by shared secret/auth header.
- No sensitive data in scheduler payloads.

## Observability

- Job execution logs with correlation IDs.
- Success/failure counters per reminder type.
- Alert on repeated send failures.

## Edge Cases and Failure Modes

- Telegram API temporary failure.
- Scheduler retry causes duplicate call.
- Missing household topic mapping.

## Test Plan

- Unit:
  - date and reminder eligibility logic
- Integration:
  - endpoint auth and idempotency behavior
- E2E:
  - simulated month schedule through all reminder events

## Acceptance Criteria

- [ ] Scheduler endpoints implemented and authenticated.
- [ ] Reminder sends are idempotent.
- [ ] Logs and counters available for each job run.
- [ ] Retry behavior validated.

## Rollout Plan

- Deploy with dry-run mode first, then enable live sends.
