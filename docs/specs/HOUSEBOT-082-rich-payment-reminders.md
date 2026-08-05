# HOUSEBOT-082 Rich Payment Reminders

## Goal

Make scheduled rent and utilities reminders useful as shared payment-status messages, not generic "time to pay" notices.

## Target Behavior

- Rent reminders show the month name, due date, unpaid members, remaining amounts, paid members, and configured rent requisites.
- Utilities reminders show the month name, due date, planned utility provider assignments, and member paid/unpaid status.
- Every scheduled reminder variant, including the no-plan utilities fallback, is delivered to the reminders topic.
- Utility-entry callbacks remain usable on fallback cards previously delivered to the notifications topic.
- Utility reminders include members whose current provider payment is zero when the plan creates a carry-forward credit for them.
- Member rows use neutral payment wording without colored urgency markers, and carry-forward copy explicitly says the credit reduces future payments.
- Scheduled reminder cards expose only shared member actions; administrative close controls remain available through dedicated administration flows.
- Shared payment cards do not offer a no-op details toggle; they point members to the dashboard for full details and payment history.
- Group `/bill` renders the same persistent shared card as a scheduled reminder. Group bill cards do not expose Home/Menu navigation, so navigation cannot replace the payment card in-place.
- The mini app shows credit created by the active utility plan as an amount carried into the next cycle before the current plan is settled.
- Live reminder cards refresh after supported payment recording flows in Telegram commands, payment topics, reminder callbacks, and the mini app.
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
- Scheduler tests cover reminders-topic routing for plain-text fallback cards.
- Utility-entry callback tests cover fallback cards already posted in the notifications topic.
- Callback tests cover actor-only payment, admin-only close-all, stale/already-paid clicks, topic rejection, old-period behavior, and Telegram edit failures.
- Finance tests cover close-period idempotency at the application/repository boundary.
