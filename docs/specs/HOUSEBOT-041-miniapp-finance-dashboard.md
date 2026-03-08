# HOUSEBOT-041: Mini App Finance Dashboard

## Summary

Expose the current settlement snapshot to the Telegram mini app so household members can inspect balances and included ledger items without leaving Telegram.

## Goals

- Reuse the same finance service and settlement calculation path as bot statements.
- Show per-member balances for the active or latest billing cycle.
- Show the ledger items that contributed to the cycle total.
- Keep the layout usable inside the Telegram mobile webview.

## Non-goals

- Editing balances or bills from the mini app.
- Historical multi-period browsing.
- Advanced charts or analytics.

## Scope

- In: backend dashboard endpoint, authenticated mini app access, structured balance payload, ledger rendering in the Solid shell.
- Out: write actions, filters, pagination, admin-only controls.

## Interfaces and Contracts

- Backend endpoint: `POST /api/miniapp/dashboard`
- Request body:
  - `initData: string`
- Success response:
  - `authorized: true`
  - `dashboard.period`
  - `dashboard.currency`
  - `dashboard.totalDueMajor`
  - `dashboard.members[]`
  - `dashboard.ledger[]`
- Membership failure:
  - `authorized: false`
  - `reason: "not_member"`
- Missing cycle response:
  - `404`
  - `error: "No billing cycle available"`

## Domain Rules

- Dashboard totals must match the same settlement calculation used by `/finance statement`.
- Money remains in minor units internally and is formatted to major strings only at the API boundary.
- Ledger items are ordered by event time, then title for deterministic display.

## Security and Privacy

- Dashboard access requires valid Telegram initData and a mapped household member.
- CORS follows the same allow-list behavior as the mini app session endpoint.
- Only household-scoped finance data is returned.

## Observability

- Reuse existing HTTP request logs from the bot server.
- Handler errors return explicit 4xx responses for invalid auth or missing cycle state.

## Edge Cases and Failure Modes

- Invalid or expired initData returns `401`.
- Non-members receive `403`.
- Empty household billing state returns `404`.
- Missing purchase descriptions fall back to `Shared purchase`.

## Test Plan

- Unit: finance command service dashboard output and ledger ordering.
- Unit: mini app dashboard handler auth and payload contract.
- Integration: full repo typecheck, tests, build.

## Acceptance Criteria

- [ ] Mini app members can view current balances and total due.
- [ ] Ledger entries match the purchase and utility inputs used by the settlement.
- [ ] Dashboard totals stay consistent with the bot statement output.
- [ ] Mobile shell renders balances and ledger states without placeholder-only content.
