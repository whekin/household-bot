# HOUSEBOT-002: Finance Domain Model

## Summary
Define domain entities and invariants for rent, utilities, shared purchases, and monthly settlements.

## Goals
- Create a deterministic model for monthly household accounting.
- Encode money-safe arithmetic with integer minor units.
- Support equal split by default with optional day-based utility override.

## Non-goals
- Telegram command handlers.
- Mini app rendering.

## Scope
- In: domain entities, use-case contracts, and validation rules.
- Out: persistence adapter implementation.

## Interfaces and Contracts
- `Money` value object (`currency: GEL`, `amountMinor: bigint | number`).
- `SettlementInput` contract with members, rent, utilities, purchases, overrides.
- `SettlementResult` contract with per-member due and explanation lines.

## Domain Rules
- Rent is fixed per cycle and split equally among active members.
- Utilities split equally unless per-member day override is provided.
- Shared purchases reduce payer due amount and distribute cost across members.
- No floating-point operations.

## Data Model Changes
- Define required table contracts (implemented in later DB ticket):
  - `billing_cycles`
  - `rent_rules`
  - `utility_bills`
  - `presence_overrides`
  - `purchase_entries`
  - `settlements`, `settlement_lines`

## Security and Privacy
- Do not store unnecessary personal data.
- Use internal IDs for members in calculations.

## Observability
- Structured calculation logs (input hash, cycle id, result totals).
- Error event on invalid settlement state.

## Edge Cases and Failure Modes
- Member count is zero.
- Utility day overrides sum to zero.
- Negative amounts from malformed inputs.
- Duplicate purchase entries.

## Test Plan
- Unit:
  - money arithmetic and normalization
  - equal split and day-weighted split cases
  - purchase offsets and reconciliation checks
- Integration: not in this ticket.
- E2E: not in this ticket.

## Acceptance Criteria
- [ ] Value objects implemented and tested.
- [ ] Settlement input/output contracts defined.
- [ ] Deterministic settlement math covered by tests.
- [ ] Edge cases produce explicit domain errors.

## Rollout Plan
- Merge as dependency for settlement engine and bot handlers.
