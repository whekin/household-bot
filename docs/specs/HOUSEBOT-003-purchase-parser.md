# HOUSEBOT-003: Purchase Parser (Hybrid Rules + LLM Fallback)

## Summary
Parse free-form purchase messages (primarily Russian) from the Telegram topic `Общие покупки` into structured ledger entries.

## Goals
- High precision amount extraction with deterministic rules first.
- Fallback to LLM for ambiguous or irregular message formats.
- Persist raw input, parsed output, and confidence score.

## Non-goals
- Receipt image OCR.
- Full conversational NLP.

## Scope
- In: parsing pipeline, confidence policy, parser contracts.
- Out: bot listener wiring (separate ticket).

## Interfaces and Contracts
- `parsePurchase(input): ParsedPurchaseResult`
- `ParsedPurchaseResult`:
  - `amountMinor`
  - `currency`
  - `itemDescription`
  - `confidence`
  - `parserMode` (`rules` | `llm`)
  - `needsReview`

## Domain Rules
- GEL is default currency when omitted.
- Confidence threshold determines auto-accept vs review flag.
- Never mutate original message text.

## Data Model Changes
- `purchase_entries` fields:
  - `raw_text`
  - `parsed_amount_minor`
  - `currency`
  - `item_description`
  - `confidence`
  - `parser_mode`
  - `needs_review`

## Security and Privacy
- Sanitize prompt inputs for LLM adapter.
- Do not send unnecessary metadata to LLM provider.

## Observability
- Parser mode distribution metrics.
- Confidence histogram.
- Error log for parse failures.

## Edge Cases and Failure Modes
- Missing amount.
- Multiple possible amounts in one message.
- Non-GEL currencies mentioned.
- Typos and slang variants.

## Test Plan
- Unit:
  - regex extraction fixtures in RU/EN mixed text
  - confidence scoring behavior
- Integration:
  - LLM fallback contract with mocked provider
- E2E: consumed in bot ingestion ticket.

## Acceptance Criteria
- [ ] Rules parser handles common RU message patterns.
- [ ] LLM fallback adapter invoked only when rules are insufficient.
- [ ] Confidence and parser mode stored in result.
- [ ] Tests include ambiguous message fixtures.

## Rollout Plan
- Start with conservative threshold and monitor review rate.
