# Live payment cards

## Summary

Keep Telegram rent and utility cards aligned with recorded payment state, regardless of whether
the payment was recorded from the payment topic, a reminder action, or the mini app.

## Target behavior

- When both rent and utilities remain open, an implicit payment uses the payment window whose
  reminder date opened most recently.
- Rent reminders use the same due-date, per-member amount, payment-destination, and native-copy
  hierarchy as `/bill`.
- Household `/bill`, scheduled reminder, and payment-instruction messages are persisted by
  Telegram message ID.
- A successful payment refreshes every persisted card for the same household, kind, and period.
- Cards that Telegram reports as no longer editable are removed from the live-card registry.
- A final “fully paid” message is sent only after the payment audit notification.
- Viewer-specific bills are not registered as household-wide live cards.

## Persistence

`telegram_payment_cards` stores the household, payment kind, period, surface, locale, Telegram
location, and message ID. `(telegram_chat_id, telegram_message_id)` is unique.

## Verification

- Proposal tests cover overlapping unpaid kinds on the rent date.
- Reminder-content tests cover the `/bill` hierarchy, escaping, and copy buttons.
- Payment-topic tests cover recorded acknowledgement and final-message ordering.
- Live-card tests cover refreshing multiple persisted surfaces into the fully-paid state.
- Migration, typecheck, bot integration, and full repository quality gates pass.
