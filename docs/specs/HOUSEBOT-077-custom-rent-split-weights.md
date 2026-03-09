# HOUSEBOT-077 Custom Rent Split Weights

## Summary

Support unequal room rents by storing a deterministic rent-share weight per active household member and using those weights in monthly settlement calculations.

## Goals

- Preserve equal split as the default when all member weights are `1`.
- Allow household admins to edit per-member rent weights from the mini app.
- Keep settlement math deterministic and money-safe.
- Reflect weighted rent shares consistently in statements and dashboard views.

## Non-goals

- Per-cycle rent weights.
- Free-form percentage editing.
- Automatic square-meter or room-type calculations.

## Scope

- In: member-level `rentShareWeight`, settlement-engine support, admin API/UI, tests.
- Out: historical backfill UI, move-in/move-out proration logic, rent history analytics.

## Data Model Changes

- Add `members.rent_share_weight integer not null default 1`.
- Existing members migrate to `1`.

## Domain Rules

- Rent weights must be positive integers.
- Active members participate in rent splitting according to their weight.
- Utility splitting remains independent from rent splitting.
- The same input must always produce the same minor-unit allocation.

## Interfaces

- Household admin mini app payload includes member `rentShareWeight`.
- Admin write endpoint updates one member rent weight at a time.

## Acceptance Criteria

- [ ] Settlement engine uses weighted rent shares.
- [ ] Equal split still holds when all weights are `1`.
- [ ] Admins can edit member rent weights in the mini app.
- [ ] Dashboard and statements reflect the new rent shares.
- [ ] Validation rejects zero or negative weights.
