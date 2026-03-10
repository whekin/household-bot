# HOUSEBOT-080 Payment Confirmations From Household Topic

## Goal

Track when members confirm rent or utility payments from a dedicated household topic, without forcing them to type an exact amount every time.

## Scope

- add a `payments` household topic role and `/bind_payments_topic`
- ingest text or caption-based confirmations from the configured payments topic
- persist every confirmation message idempotently
- record deterministic payment entries when the bot can resolve the amount safely
- keep ambiguous confirmations in `needs_review` instead of guessing
- expose paid and remaining amounts in the finance dashboard

## Parsing rules

- detect `rent` intent from phrases like `за жилье`, `аренда`, `paid rent`
- detect `utilities` intent from phrases like `коммуналка`, `газ`, `электричество`, `utilities`
- treat generic confirmations like `готово` as review-required
- treat multi-person confirmations like `за двоих` or `за Кирилла и себя` as review-required
- parse explicit amounts when present
- if no amount is present:
  - `rent` resolves to the member's current rent share
  - `utilities` resolves to `utilityShare + purchaseOffset`

## Persistence

- `payment_confirmations`
  - stores raw Telegram message context and normalized review state
- `payment_records`
  - stores accepted cycle-scoped payments in settlement currency

## Acceptance

- a member can say `за жилье закинул` or `оплатил коммуналку` in the configured payments topic
- the bot records the payment against the current cycle when resolution is deterministic
- the dashboard shows `due`, `paid`, and `remaining`
- ambiguous confirmations are stored for review, not silently converted into money movements
