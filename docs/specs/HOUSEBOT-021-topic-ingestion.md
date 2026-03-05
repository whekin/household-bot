# HOUSEBOT-021: Purchase Topic Ingestion

## Summary

Ingest messages from configured Telegram household purchase topic (`Общие покупки`) and persist raw message metadata idempotently.

## Goals

- Process only configured chat/topic.
- Persist sender + raw message + Telegram metadata.
- Make ingestion idempotent for duplicate Telegram deliveries.

## Non-goals

- Purchase amount parsing.
- Settlement impact calculations.

## Scope

- In: bot middleware for topic filtering, persistence repository, DB schema for raw inbox records.
- Out: parser pipeline and command responses.

## Interfaces and Contracts

- Telegram webhook receives update.
- Bot middleware extracts candidate from `message:text` updates.
- DB write target: `purchase_messages`.

## Domain Rules

- Only configured `TELEGRAM_HOUSEHOLD_CHAT_ID` + `TELEGRAM_PURCHASE_TOPIC_ID` are accepted.
- Empty/blank messages are ignored.
- Duplicate message IDs are ignored via unique constraints.

## Data Model Changes

- Add `purchase_messages` with:
  - sender metadata
  - raw text
  - Telegram IDs (chat/message/thread/update)
  - processing status (`pending` default)

## Security and Privacy

- No PII beyond Telegram sender identifiers needed for household accounting.
- Webhook auth remains enforced by secret token header.

## Observability

- Log successful ingestion with chat/thread/message IDs.
- Log ingestion failures without crashing bot process.

## Edge Cases and Failure Modes

- Missing ingestion env config -> ingestion disabled.
- Unknown sender member -> stored with null member mapping.
- Duplicate webhook delivery -> ignored as duplicate.

## Test Plan

- Unit tests for topic filter extraction logic.
- Existing endpoint tests continue to pass.

## Acceptance Criteria

- [ ] Only configured topic messages are persisted.
- [ ] Sender + message metadata stored in DB.
- [ ] Duplicate deliveries are idempotent.

## Rollout Plan

- Deploy with ingestion enabled in dev group first.
- Validate rows in `purchase_messages` before enabling parser flow.
