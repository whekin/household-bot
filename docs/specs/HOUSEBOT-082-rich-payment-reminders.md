# HOUSEBOT-082 Rich Payment Reminders

## Goal

Make scheduled rent and utilities reminders useful as shared payment-status messages, not generic "time to pay" notices.

## Target Behavior

- Rent reminders show the month name, due date, unpaid members, remaining amounts, paid members, and configured rent requisites.
- Utilities reminders show the month name, due date, planned utility provider assignments, and member paid/unpaid status.
- Reminder messages are compact by default and can be expanded in-place with a details button.
- "I paid" closes the clicking member's unresolved payment period only.
- Utilities "I paid" means the member paid assigned utility providers according to the plan, not reimbursed another member.
- Already-paid, stale, and concurrent clicks do not create duplicate payment records or duplicate planned utility facts.
- Admin close-all is two-step and rechecks current state before mutating.
- Old reminders may act only on their explicit period. They must never silently fall back to the current cycle.

## Privacy And Detail Scope

The group message may show shared operational state: totals, assignments, member paid/unpaid status, and rent requisites. Full purchase history stays in the dashboard for now.

Out of scope for this pass:

- DM-only detail views
- auto-deleting secondary detail messages
- arbitrary purchase-ledger dumps in the group reminder

## Verification

- Formatter tests cover rent, utilities, fully paid, details, month labels, and HTML escaping.
- Callback tests cover actor-only payment, admin-only close-all, stale/already-paid clicks, topic rejection, old-period behavior, and Telegram edit failures.
- Finance tests cover close-period idempotency at the application/repository boundary.
