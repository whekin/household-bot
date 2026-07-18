# Rent bill message UX

## Summary

Make Telegram rent bills easy to scan and act on. The message should emphasize the due date and each resident's current amount, while every configured bank account remains visible and can be copied directly.

## Target behavior

- Render rent bills with Telegram HTML formatting and escape all dynamic household, member, and payment-destination values.
- Use `К оплате` / `Amount due` instead of language that implies a partially paid balance.
- Present each resident as one visually distinct status row, with paid residents clearly marked.
- Group payment destinations by bank and label.
- Show each account in a copy-friendly code span.
- Add one native Telegram copy button per valid account while preserving existing navigation buttons.
- Keep personal rent bills compact by omitting the resident name and showing only the viewer's payment status.

## Edge cases

- Bills without payment destinations still render normally and have no copy buttons.
- Accounts longer than Telegram's 256-character copy-button limit remain visible but do not produce a misleading truncated copy action.
- Multiple destinations produce separate copy buttons in the same order as the message.

## Verification

- Rent command tests assert HTML parse mode, the revised Russian wording and hierarchy, escaped dynamic values, code-formatted accounts, and the native copy-button payload.
- Existing utility and idle bill modes remain plain text.
- Full repository format, lint, typecheck, test, and build gates pass.
