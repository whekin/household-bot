# Admin rent controls in Billing settings and the household agent

## Summary

Make temporary rent changes easy to discover in Mini app Billing settings and safe to request through the household bot. Admins can manage the default rent plus explicit current- and next-cycle amounts in one place, or ask the bot to propose the same period-specific change.

## Goals

- Show default, current-cycle, and next-cycle rent together under Settings → Billing.
- Distinguish an explicit period override from a period that follows the household default.
- Allow an admin to request rent changes for one or more explicit periods in natural language.
- Require an admin confirmation card before the bot changes rent.

## Non-goals

- Letting the model mutate settings directly.
- Bot tools for every household setting in this slice.
- Removing the existing `/rent_set` command or Activity rent shortcut.

## Interfaces and Contracts

- `POST /api/miniapp/admin/billing-cycle` accepts optional `period: YYYY-MM` and returns an exact rent rule even if no cycle exists yet.
- `FinanceRepository.getRentRuleStartingAtPeriod(period)` reads only a rule that starts in that period; it does not return an inherited earlier rule.
- Admin agent tool: `propose_period_rent { amount_major, currency, periods[] }`.
- Rent read tool: `get_rent_settings { periods? }` returns the household default separately from effective period amounts and labels each period as `household_default`, `period_override`, or `unconfigured`.
- Confirmation payload: `set_period_rent { amountMajor, currency, periods[] }`.

## Domain Rules

- Household default rent remains the long-term value used to initialize future periods.
- Current and next period values are explicit rules and may equal the default.
- Money is validated through the domain `Money` value object; periods through `BillingPeriod`.
- The agent tool is only exposed to admins, validates admin status again when invoked, and requires the confirming actor to still be an admin.

## Security and Privacy

- Mini app endpoints retain Telegram init-data authentication and household admin authorization.
- Model output can only create a pending proposal; mutation happens in the callback handler after authorization is re-checked.
- Rent-change audit notifications are emitted only after persistence and use completed-action wording; confirmation cards remain explicitly pending with Confirm/Cancel buttons. Confirmed generic agent actions also publish their completed result text instead of reusing the pending infinitive summary.
- Agent replies distinguish a saved configuration fact from an external human agreement. They lead with verified values and refer unresolved agreement context to the named actor instead of volunteering capability disclaimers.

## Edge Cases and Failure Modes

- A next-period rule can exist before its billing cycle; the API returns it with `cycle: null`.
- If loading the next period fails, the settings editor remains usable and shows an error toast.
- Invalid/non-positive amounts and malformed periods are rejected before creating or executing an agent action.

## Test Plan

- Application: exact future rent rule without an open cycle.
- Mini app API: requested future period reaches the finance service.
- Agent: tool visibility, confirmation payload, non-admin rejection, confirmation-time admin guard.
- Full format, lint, typecheck, test, and build gates.

## Acceptance Criteria

- [x] Billing settings contains default/current/next rent controls.
- [x] Future explicit rules are readable without opening a cycle.
- [x] Admin natural-language rent requests create confirmation cards only.
- [x] Confirmation re-checks admin privileges.
- [x] Agent reads distinguish default rent from effective current and scheduled rent.
- [x] Full quality gates pass.

## Follow-up design

Additional bot-managed settings should use a small allowlisted registry of typed patches (due days, timezone, notification toggles, payment destinations). Each patch should include a localized before/after summary and go through the same admin-only confirmation and audit path. Sensitive or structurally complex settings should remain Mini app only until they have dedicated validation and preview UX.
