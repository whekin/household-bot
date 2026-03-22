# HOUSEBOT-007 Terraform IaC Baseline

## Summary

Define a reproducible GCP infrastructure baseline for deployment of the bot API and mini app, including scheduling and secrets.

## Goals

- Provision Cloud Run services for bot API and mini app.
- Provision Cloud Scheduler reminder trigger.
- Provision Secret Manager placeholders and runtime access bindings.
- Provision Artifact Registry repository for container images.
- Provide optional GitHub OIDC Workload Identity resources.

## Non-goals

- Business feature implementation.
- Full observability stack (Grafana/Prometheus) in this ticket.
- Multi-region failover.

## Scope

- In: Terraform scaffold, docs, CI validation.
- Out: runtime deploy script rewrites, production dashboard configuration.

## Interfaces and Contracts

- Scheduler sends HTTP request to `POST /internal/scheduler/reminders`.
- Bot runtime reads secret-backed env vars:
  - `TELEGRAM_WEBHOOK_SECRET`
  - `SCHEDULER_SHARED_SECRET`
  - `APP_DATABASE_URL` (optional)
  - `WORKER_DATABASE_URL` (optional)

## Domain Rules

- N/A (infrastructure-only change).

## Data Model Changes

- None.

## Security and Privacy

- Runtime access to secrets is explicit via `roles/secretmanager.secretAccessor`.
- Scheduler uses OIDC token with dedicated service account.
- GitHub OIDC setup is optional and repository-scoped.

## Observability

- Out of scope for this ticket.

## Edge Cases and Failure Modes

- Missing secret versions causes runtime startup/read failures.
- Scheduler remains paused by default to avoid accidental reminders.
- Incorrect `bot_api_image` or `mini_app_image` tags causes deployment failures.

## Test Plan

- Unit: N/A
- Integration: `terraform validate`
- E2E: Apply in dev project and verify service URLs + scheduler job presence.

## Acceptance Criteria

- [ ] `terraform plan` succeeds with provided vars.
- [ ] Two Cloud Run services and one Scheduler job are provisioned.
- [ ] Runtime secret access is bound explicitly.
- [ ] CI validates Terraform formatting and configuration.
- [ ] Runbook documents local and CI workflow.

## Rollout Plan

- Apply to dev first with scheduler paused.
- Add secret versions.
- Unpause scheduler after reminder endpoint is implemented and verified.
