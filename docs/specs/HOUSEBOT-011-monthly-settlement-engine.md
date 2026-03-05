# HOUSEBOT-011: Monthly Settlement Engine

## Summary

Implement a deterministic monthly settlement use-case that computes per-member dues from rent, utilities, and shared purchases.

## Goals

- Compute per-member net due amounts deterministically.
- Support utility split modes: equal and weighted-by-days.
- Model purchase offsets where payer reimbursement reduces their due.

## Non-goals

- Persistence adapters.
- Telegram command handlers.

## Scope

- In: pure settlement use-case logic and tests.
- Out: DB writes, HTTP/bot integration.

## Interfaces and Contracts

- Input: `SettlementInput` from `@household/domain`.
- Output: `SettlementResult` with per-member line breakdown.
- Entry point: `calculateMonthlySettlement(input)` in application package.

## Domain Rules

- Use integer minor units only via `Money` value object.
- Rent is split evenly among active members.
- Utility split:
  - `equal`: evenly among active members.
  - `weighted_by_days`: proportional to `utilityDays` for each active member.
- Purchase offset per member:
  - `purchaseSharedCost - purchasePaid`
- Net due:
  - `rentShare + utilityShare + purchaseOffset`

## Data Model Changes

- None.

## Security and Privacy

- No PII required in settlement computation.
- Uses internal typed member IDs only.

## Observability

- Explanations list on each line provides deterministic calculation fragments.

## Edge Cases and Failure Modes

- No active members.
- Weighted utility split with invalid or missing day values.
- Purchase payer not in active members.
- Negative monetary inputs.
- Currency mismatch across input values.

## Test Plan

- Unit:
  - 3-member equal split with purchase offset.
  - 4-member weighted utility split.
  - 5-member deterministic fixture with multiple purchases.
  - Invalid weighted utility day input.
  - Invalid purchase payer.

## Acceptance Criteria

- [ ] Equal utility split default implemented.
- [ ] Day-based utility split implemented.
- [ ] Deterministic fixtures for 3-5 roommate scenarios.
- [ ] Explicit errors for invalid settlement inputs.

## Rollout Plan

- Merge as dependency for bot command handlers and statement generation flow.
