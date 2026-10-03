# Utility screenshots in replies to reminders

## Summary

Household members can reply to a utility reminder with a Credo/TBC screenshot,
review the recognized balances, and save and distribute the bills with one confirmation.
No dedicated utility topic is required.

## Scope and behavior

- A photo or PNG/JPEG document replying to a bot utility card uses that card's period.
- An explicitly addressed utility screenshot can use the household's current calendar period.
- Unaddressed images elsewhere in the group pass through without OCR or finance writes.
- Images addressed to the bot without utility intent receive instructions, without OCR.
- Unrelated images, payment receipts, unreadable images and unknown providers never create bills.
- Explicit captions reporting a completed payment retain the existing payment flow; a
  captionless receipt alone never records payment. Purchase captions keep their existing flow.
- Recognition extracts provider, customer number, category, GEL balance and reading confidence.
  Image text is untrusted evidence, never executable instructions.
- Negative balances on these bank screens are normalized to positive amounts due. Generic
  category tiles, phone balances and unrelated transfers are excluded.
- Matching uses configured provider/customer numbers and supported supplier aliases.
  Conflicting customer numbers and ambiguous category matches require correction.
- Preview displays month, exact amounts, total, unchanged entries and old → new changes.
  Missing categories remain unchanged. Zero is explicit; absence never becomes zero.
- Confirm, edit amounts, change month and cancel are scoped to the actor, chat, thread,
  proposal and expiration. Edited input is validated strictly, including detached numbers.
- Import is atomic with an optimistic revision check. Concurrent imports cannot silently
  duplicate or overwrite bills; identical Credo/TBC submissions are no-ops.
- Closed cycles block import. After recorded payments, existing positive charges are preserved
  with a dashboard correction path for charge changes. New bills and previously zero bills are allowed; incoming
  post-payment balances preserve the original bills. Late additions recalculate the remaining
  provider assignments while keeping prior payments exactly once. Fresh data is checked at confirmation time.
- After saving, live cards refresh and payment instructions are published. Failure to
  refresh/publish never falsely reports that saving failed.

## Architecture and persistence

- Pure validation/matching and import preview live in application, with ports for OCR and
  atomic import persistence. OpenAI and Telegram calls live in bot adapters.
- Use existing category provider/customer metadata, utility bills and pending-action storage.
  Persist bills with source `bank_screenshot`; no schema migration or image retention.
- Download Telegram files locally in memory with size and time limits; send base64 input
  through Responses structured outputs, never a Telegram URL containing the bot token.
- Use existing configured OpenAI model/key. OCR availability does not disable text entry.

## Test plan and acceptance criteria

- Both supplied screen layouts map to Electricity 44.02, Cleaning 2.50, Gas 20.30,
  Internet 61.39 GEL (total 128.21), with mocked extraction and opt-in live replay.
- Routing covers direct reminder replies, historical periods, ordinary groups, random images,
  receipt screens, unknown members, foreign threads, invalid files and recognition failure.
- Confirmation covers edits/month changes, wrong actor, expiry, replay, changed snapshot,
  duplicates, partial input, paid/closed cycles and post-save delivery failure.
- Atomic DB tests cover rollback and concurrent confirmations when local test DB is available.
- Format, lint, typecheck, test and build pass. Production push and deployment explicitly authorized by the user on October 3.

## References

- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## Late bills after payment

- New utility bills automatically update the open cycle's plan even when earlier assignments
  are paid, or the utility plan is fully settled. Closed historical cycles remain read-only.
- Previously paid assignments remain visible under their actual payers and never become
  another charge. Partial payments are counted as baseline funding exactly once.
- Member payment queues include baseline paid amounts and expose only the remaining top-up.
  Repeated confirmation is idempotent across plan versions.
- Each category exposes its own remaining amount; bank/provider total paid amounts never
  substitute for an individual assignment's paid status.
- Mini-app admin redraw is available while the payment stage is idle, and the preview shows
  each member's remaining amount before and after.
- Validate the full sequence on PostgreSQL: Ion pays, a late bill arrives via screenshot
  import, the plan reopens, Ion pays only his remainder, and repeated confirmation is a no-op.

- Same-cycle purchase adjustments already funded by utility payments remain in the cycle's
  pricing during redraw. Live purchase balances stay resolved; the funded portion is not
  credited toward later utilities a second time. Clamp retained adjustments to current
  purchase shares in chronological allocation order; other-cycle and manual receipts stay
  excluded. Snapshot metadata records the retained pricing adjustments.
- Regression covers four PostgreSQL variants: only Ion/all members paid, with/without a
  purchase adjustment already settled through utilities, followed by repeat confirmation
  and a redraw after all bills are paid.

- Category assignment totals include historical provider contributions, with a separately
  persisted baseline remainder. A partial contribution stays visible under its payer after
  redraw, and only the remainder can be recorded as another payment. Existing stored plans
  lacking the remainder field are read using their original assignment/payment facts.

## Rounded and unreported provider payments

- Bank balances are observations of the current debt, not replacement charges. Once the cycle has a recorded utility payment, retain all existing positive charges even if bank remainders differ. Another bill may have an unreported payment too. Show the expected and observed remainders; late new bills can still be saved.
- A discrepancy never identifies its payer automatically: someone else may have paid without reporting it. Neither the screenshot nor ordinary bill confirmation creates a payment.
- A positive difference of up to 2 GEL offers an optional rounding shortcut. The user selects the actual payer and separately confirms the additional amount. Non-admin members may only attribute it to themselves; an administrator may select another household member who has not left. Temporarily away members retain payment rights.
- Larger differences, increased bank debt, zero difference and a fully covered charge do not offer the shortcut. Reconcile actual payments/new charges separately; importing late Internet remains possible. The 2 GEL limit is only for this shortcut, not a cap on explicitly reported actual payments.
- Confirmation rechecks the snapshot revision and writes the payment record plus linked off-plan vendor fact atomically. Replay/concurrent attempts cannot double-credit, and roles/lifecycle are revalidated in the transaction. The payer's credit lowers subsequent remaining assignments.
- While a bill still has an unpaid balance, an explicitly reported vendor payment can exceed that remainder (a provider advance). Retain the complete payment under its payer; never increase the charge to absorb the advance or pretend it pays another supplier. A fully covered bill still rejects repeated payment recording.
- Validate 51.93 recorded vs 52 actual and 20.37 expected vs 20.30 bank remainder; old charge 72.30 remains, 0.07 credit belongs only to the explicitly selected payer, and new Internet is distributed without duplicate funding.
