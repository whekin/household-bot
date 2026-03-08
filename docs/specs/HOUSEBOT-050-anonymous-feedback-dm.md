# HOUSEBOT-050: Anonymous Feedback DM Flow

## Summary

Allow household members to send private `/anon` messages to the bot and have them reposted into a configured household topic without exposing the sender.

## Goals

- Keep sender identity hidden from the group.
- Enforce simple anti-abuse policy with cooldown, daily cap, and blocklist checks.
- Persist moderation and delivery metadata for audit without any reveal path.

## Non-goals

- Identity reveal tooling.
- LLM rewriting or sentiment analysis.
- Admin moderation UI.

## Scope

- In: DM command handling, persistence, reposting to topic, deterministic sanitization, policy enforcement.
- Out: anonymous reactions, editing or deleting previous posts.

## Interfaces and Contracts

- Telegram command: `/anon <message>` in private chat only
- Runtime config:
  - `TELEGRAM_HOUSEHOLD_CHAT_ID`
  - `TELEGRAM_FEEDBACK_TOPIC_ID`
- Persistence:
  - `anonymous_messages`

## Domain Rules

- Sender identity is never included in the reposted group message.
- Cooldown is six hours between accepted submissions.
- Daily cap is three accepted submissions per member in a rolling 24-hour window.
- Blocklisted abusive phrases are rejected and recorded.
- Links, `@mentions`, and phone-like strings are sanitized before repost.

## Data Model Changes

- `anonymous_messages`
  - household/member linkage
  - raw text
  - sanitized text
  - moderation status and reason
  - source Telegram message IDs
  - posted Telegram message IDs
  - failure reason and timestamps

## Security and Privacy

- Household membership is verified before accepting feedback.
- Group-facing text contains no sender identity or source metadata.
- Duplicate Telegram updates are deduplicated at persistence level.

## Observability

- Failed reposts are persisted with failure reasons.
- Moderation outcomes remain queryable in the database.

## Edge Cases and Failure Modes

- Command used outside DM is rejected.
- Duplicate webhook delivery does not repost.
- Telegram post failure marks the submission as failed without exposing the sender.

## Test Plan

- Unit: moderation, cooldown, and delivery state transitions.
- Bot tests: DM command path and private-chat enforcement.
- Integration: repo quality gates and migration generation.

## Acceptance Criteria

- [ ] DM to household topic repost works end-to-end.
- [ ] Sender identity is hidden from the reposted message.
- [ ] Cooldown, daily cap, and blocklist are enforced.
- [ ] Moderation and delivery metadata are persisted.
