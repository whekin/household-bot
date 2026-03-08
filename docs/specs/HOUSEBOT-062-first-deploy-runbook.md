# HOUSEBOT-062: First Deployment Runbook and Cutover Checklist

## Summary

Document the exact first-deploy sequence so one engineer can provision, deploy, cut over Telegram webhook traffic, validate the runtime, and roll back safely without tribal knowledge.

## Goals

- Provide one runbook that covers infrastructure, CD, webhook cutover, smoke checks, and scheduler enablement.
- Close configuration gaps that would otherwise require ad hoc manual fixes.
- Add lightweight operator scripts for webhook management and post-deploy validation.

## Non-goals

- Full production monitoring stack.
- Automated blue/green or canary deployment.
- Elimination of all manual steps from first deploy.

## Scope

- In: first-deploy runbook, config inventory, smoke scripts, Terraform runtime config needed for deploy safety.
- Out: continuous release automation redesign, incident response handbook.

## Interfaces and Contracts

- Operator scripts:
  - `bun run ops:telegram:webhook info|set|delete`
  - `bun run ops:deploy:smoke`
- Runbook:
  - `docs/runbooks/first-deploy.md`
- Terraform runtime config:
  - optional `bot_mini_app_allowed_origins`

## Security and Privacy

- Webhook setup uses Telegram secret token support.
- Post-deploy validation does not require scheduler auth bypass.
- Mini app origin allow-list is configurable through Terraform instead of ad hoc runtime mutation.

## Observability

- Smoke checks verify bot health, mounted app routes, and Telegram webhook state.
- Runbook includes explicit verification before scheduler jobs are unpaused.

## Edge Cases and Failure Modes

- First Terraform apply may not know the final mini app URL; runbook includes a second apply to set allowed origins.
- Missing `DATABASE_URL` in GitHub secrets skips migration automation.
- Scheduler jobs remain paused and dry-run by default to prevent accidental sends.

## Test Plan

- Unit: script typecheck through workspace `typecheck`.
- Integration: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run infra:validate`.
- Manual: execute the runbook in dev before prod cutover.

## Acceptance Criteria

- [ ] A single runbook describes the full first deploy flow.
- [ ] Required secrets, vars, and Terraform values are enumerated.
- [ ] Webhook cutover and smoke checks are script-assisted.
- [ ] Rollback steps are explicit and environment-safe.
