# HOUSEBOT-094 Direct member repayments

## Summary

Housemates can request return of outstanding credit and record partial direct transfers without entering a purchase or waiting for utility cycles.

## Scope and rules

- Activity offers requests, recording transfers, recipient confirmation, and history.
- Requests do not move balances. A sender records a transfer; only its recipient confirms receipt. Either party can cancel a pending transfer. Request owners can close their requests.
- Each confirmed transfer credits the sender and debits the recipient equally. Other members and household spending totals are unchanged. Transfers may exceed the sender's debt, creating credit.
- Use the household settlement currency, positive integer minor units, and an explicit date (no future dates).
- A request is capped at the recipient's current outstanding credit. Contributions can be any positive partial amount; no compulsory split or deadline.
- Confirmed records are immutable. Request progress counts confirmed linked transfers only.
- All operations are household-scoped; retries use a stable UUID and transitions compare the expected status atomically.
- Transfer obligations participate in subsequent settlement alongside outstanding purchase shares. Persist their resolution against actual billing payments, so later utility cycles cannot clear the same balance twice.
- Closed cycle archives remain unchanged. No Telegram broadcast, bank integration, commit, or deployment in this scope.

## Data and API

A member_repayments table stores requests and transfers. Payment allocations can reference a purchase or a transfer, exclusively. POST /api/miniapp/repayments exposes list, request, transfer, confirm, cancel, and close actions to authenticated members.

## Validation

Test partial and excess transfers, unchanged bystander balances and totals, pending/duplicate confirmation, authorization, request progress, cancellation, and settlement across cycles. Run repository hooks and inspect the mini app flow.
