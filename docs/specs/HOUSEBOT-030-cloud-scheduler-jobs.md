# HOUSEBOT-030: Cloud Scheduler Reminder Jobs

## Summary

Provision dedicated Cloud Scheduler jobs for the three reminder flows and align runtime auth with Cloud Scheduler OIDC tokens.

## Goals

- Provision separate scheduler jobs for utilities, rent warning, and rent due reminders.
- Target the runtime reminder endpoints added in `HOUSEBOT-031`.
- Keep first rollout safe with paused and dry-run controls.

## Non-goals

- Final live Telegram reminder delivery content.
- Per-household scheduler customization beyond cron variables.

## Scope

- In: Terraform scheduler resources, runtime OIDC config, runbook updates.
- Out: production cutover checklist and final enablement procedure.

## Interfaces and Contracts

- Cloud Scheduler jobs:
  - `/jobs/reminder/utilities`
  - `/jobs/reminder/rent-warning`
  - `/jobs/reminder/rent-due`
- Runtime env:
  - `SCHEDULER_OIDC_ALLOWED_EMAILS`

## Domain Rules

- Utility reminder defaults to day 4 at 09:00 `Asia/Tbilisi`, but remains cron-configurable.
- Rent warning defaults to day 17 at 09:00 `Asia/Tbilisi`.
- Rent due defaults to day 20 at 09:00 `Asia/Tbilisi`.
- Initial rollout should support dry-run mode.

## Security and Privacy

- Cloud Scheduler uses OIDC token auth with the scheduler service account.
- Runtime verifies the OIDC audience and the allowed service account email.
- Shared secret auth remains available for manual/dev invocation.

## Observability

- Scheduler request payloads include a stable `jobId`.
- Runtime logs include `jobId`, `dedupeKey`, and outcome.

## Test Plan

- Runtime auth unit tests for shared-secret and OIDC paths.
- Terraform validation for reminder job resources.

## Acceptance Criteria

- [ ] Three scheduler jobs are provisioned with distinct schedules.
- [ ] Runtime accepts Cloud Scheduler OIDC calls for those jobs.
- [ ] Initial rollout can remain paused and dry-run.
