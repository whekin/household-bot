# HOUSEBOT-091 — Billing cycle history

## Status

Implemented.

## Problem

The mini app explains the active billing cycle well, but residents cannot browse a concise,
trustworthy record of prior months. Rebuilding an old dashboard from current settings is also
unsafe: member settings, payment rules, and utility plans may have changed since the cycle closed.

## Goal

Give every active household member a read-only monthly archive backed by the settlement snapshot
that was frozen when the cycle closed.

## Scope

- Show closed billing cycles newest first in the Activity tab.
- For each archived cycle, show:
  - total due, paid, and remaining;
  - rent, utility, and shared-purchase totals;
  - purchase count;
  - the frozen per-member rent, utility, purchase-offset, due, paid, and remaining figures;
  - shared-purchase contributions grouped by payer.
- Materialize the final archive snapshot before closing a cycle.
- Never replace a closed cycle snapshot while rendering or reading history.
- Support existing closed cycles whose older snapshot metadata does not contain the richer archive
  payload by deriving a clearly marked legacy view from their frozen settlement lines and
  cycle-linked records.
- Keep history read-only for both residents and administrators.
- Preserve RU/EN localization and Telegram light/dark themes.

## Out of scope

- Purchase categories and category charts (planned for HOUSEBOT-092).
- Cross-month trends and shareable “House Wrapped” cards (planned for HOUSEBOT-093).
- Editing closed-cycle finance records.
- A database migration; the existing settlement metadata JSON stores the archive payload.

## Accounting and lifecycle rules

- Amounts remain integer minor units in application and persistence layers.
- The archive uses the cycle settlement currency.
- Only purchases belonging to the archived cycle contribute to its purchase volume.
- A cycle close must fail rather than close without first materializing its final dashboard
  snapshot.
- Once the cycle is closed, dashboard generation must not replace its settlement snapshot or
  rebalance its utility plan.

## Acceptance criteria

1. An authenticated active member can browse closed cycles from Activity.
2. History summaries are ordered newest first and exclude the active cycle.
3. Opening a month shows frozen household and member totals.
4. Closing an active cycle persists the rich archive before marking it closed.
5. Generating a dashboard for a closed cycle does not replace its snapshot.
6. Legacy snapshots remain visible without a migration.
7. Backend and UI regression tests cover ordering, snapshot freezing, serialization, and archive
   presentation.
