# Financial consistency and transparent utility payments

## Problem

Payment instructions exposed original assignments as current amounts without paid status.
After late bills, carried contributions did not keep issued plans locked against new purchases.
Named partial payments lost their provider identity, and purchase debt was not reconciled from
cumulative confirmed payments. History presented rounding adjustments as ordinary transfers.

## Required behavior

- Equal purchase splits assign remainder units by ascending stable member ID. Cards,
  settlement, dashboard balances and previews use the same rule regardless of participant row order.
- Cards, dashboard and assistant use exact remaining amounts. Settled obligations pay zero;
  show an already-paid baseline alongside an additional utility remainder.
- Carried contributions continue to lock issued assignments. New purchases remain separate;
  late bills and explicit redraw preserve existing funding exactly once.
- Named utility confirmations include bill identity and the exact confirmed amount. Record
  payment and provider contribution atomically, validating cycle, payer, currency and coverage.
- Retries never duplicate money. Concurrent plan creation reuses an equivalent plan and never
  replaces a newer plan with a stale calculation.
- Provider-linked edits and either deletion path synchronize both representations. Reject
  overfunding and unauthorized ownership changes. Use the cycle's fixed FX rate.
- Reconcile shared-purchase allocations against cumulative actual payments in the current
  period. Replace prior allocations atomically with a revision check and retry stale reads.
  Save immutable per-receipt pricing, eligible debt lots, fixed FX, and a server-assigned
  receipt phase. Later bills cannot undo purchase funding established in earlier phases;
  backdated user reports do not reorder those phases. Reducing or deleting an installment
  restores only debt no longer funded. Clamp available funding to current participant shares,
  subtract allocations owned by other sources, and preserve manual-resolution anchors.
  Purchase corrections mark affected open balances pending in the same transaction.
- Validate captured pricing and current reconciliation capacities with separate source fingerprints
  under the write lock. A changed source requires a full recalculation before storing allocations.
- Reconcile prepared periods against their own cycle; historical duplicate retries only clear
  bookkeeping markers and never delete archived purchase funding.
- Recover pending work before closure, verify the frozen archive's exact source fingerprint,
  and prevent closure when recovery fails. Manual resolutions are atomic, reject excess shares,
  and obey the same closed-period and source-revision safeguards.
- Persist a reconciliation marker with each source write. Duplicate confirmations and dashboard
  reads retry pending balances. A saved receipt with pending derived work must say so, keep
  a retry action, and never claim the payment failed or record it twice.
- Closed-period edits and deletions are rejected. Historical additional receipts remain governed
  by the existing oldest-first debt collection rules; closed archive snapshots stay immutable.
- A combined utility receipt with provider distributions cannot be changed only on the cash side;
  deletion and new provider-specific receipts make the correction explicit.
- Parse lari, tetri, compound units and currency symbols exactly. Malformed amounts and multiple
  named providers require clarification rather than a guessed allocation.
- Mark automatic rounding adjustments explicitly in history and agent ledger tools. Do not
  turn a rounding adjustment into an unrelated larger transfer.
- Inspect recent records first when correcting a payment. Historical-payment wording must
  distinguish a new transfer from one already recorded.
- Screenshots replying to payment confirmations retain payment/conversation context and do
  not enter the bill-import flow automatically.
- Bulk admin actions stay in authenticated dashboard tools, outside public payment messages.

## Verification

Unit and real PostgreSQL regressions cover partial/full/rounded payments, retries, concurrent
confirmation, late bills, purchase changes, edits, deletions, exact units and balance funding.
Existing rent/FX/rollover/repayment/history suites remain required. Run format, lint, typecheck,
tests, build, migration hygiene and Codex review before release. Production diagnosis is read-only;
historical accounting corrections require verified evidence and a separate concrete approval.
