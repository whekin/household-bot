# HOUSEBOT-020: grammY Webhook Bot Scaffold

## Summary

Build a Cloud Run-compatible webhook server for Telegram bot updates with command routing stubs.

## Goals

- Expose `/healthz` endpoint.
- Expose webhook endpoint with secret header validation.
- Register basic command stubs for `/help` and `/household_status`.

## Non-goals

- Purchase ingestion logic.
- Billing command business logic.

## Scope

- In: bot runtime config, webhook server, command stubs, endpoint tests.
- Out: persistence integration and scheduler handlers.

## Interfaces and Contracts

- `GET /healthz` -> `{ "ok": true }`
- `POST /webhook/telegram` requires header:
  - `x-telegram-bot-api-secret-token`

## Domain Rules

- Reject unauthorized webhook calls (`401`).
- Reject non-POST webhook calls (`405`).

## Data Model Changes

- None.

## Security and Privacy

- Validate Telegram secret token header before processing updates.

## Observability

- Startup log includes bound port and webhook path.

## Edge Cases and Failure Modes

- Missing required bot env vars.
- Requests to unknown paths.

## Test Plan

- Unit/integration-like tests for endpoint auth and method handling.

## Acceptance Criteria

- [ ] Health endpoint exists.
- [ ] Webhook endpoint validates secret header.
- [ ] `/help` and `/household_status` command stubs exist.

## Rollout Plan

- Deploy webhook service in dry mode first, then register Telegram webhook URL.
