# HOUSEBOT-022: Hybrid Purchase Parser

## Summary

Implement a rules-first purchase parser with optional LLM fallback for ambiguous Telegram purchase messages.

## Goals

- Parse common RU/EN purchase text with deterministic regex rules first.
- Call LLM fallback only when rules cannot safely resolve a single amount.
- Persist raw + parsed fields + confidence + parser mode.

## Non-goals

- Receipt OCR.
- Complex multi-item itemization.

## Scope

- In: parser core logic, fallback interface, bot ingestion integration, DB fields for parser output.
- Out: settlement posting and command UIs.

## Interfaces and Contracts

- `parsePurchaseMessage({ rawText }, { llmFallback? })`
- Parser result fields:
  - `amountMinor`
  - `currency`
  - `itemDescription`
  - `confidence`
  - `parserMode` (`rules` | `llm`)
  - `needsReview`

## Domain Rules

- Rules parser attempts single-amount extraction first.
- Missing currency defaults to GEL and marks `needsReview=true`.
- Ambiguous text (multiple amounts) triggers LLM fallback if configured.

## Data Model Changes

- `purchase_messages` stores parsed fields:
  - `parsed_amount_minor`
  - `parsed_currency`
  - `parsed_item_description`
  - `parser_mode`
  - `parser_confidence`
  - `needs_review`
  - `parser_error`

## Security and Privacy

- LLM fallback sends only minimal raw text needed for parsing.
- API key required for fallback path.

## Observability

- `processing_status` and `parser_error` capture parse outcomes.

## Edge Cases and Failure Modes

- Empty message text.
- Multiple numeric amounts.
- Invalid LLM output payload.
- Missing API key disables LLM fallback.

## Test Plan

- Unit tests for rules parser and fallback behavior.
- Ingestion tests for topic filter remain valid.

## Acceptance Criteria

- [ ] Rules parser handles common message patterns.
- [ ] LLM fallback is invoked only when rules are insufficient.
- [ ] Parsed result + confidence + parser mode persisted.

## Rollout Plan

- Enable in dev group and monitor `needs_review` rate before stricter auto-accept rules.
