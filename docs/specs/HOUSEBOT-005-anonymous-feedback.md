# HOUSEBOT-005: Anonymous Feedback Flow

## Summary
Allow members to submit anonymous household feedback to the bot via DM, then repost sanitized messages to a configured topic.

## Goals
- Protect sender identity in group output.
- Reduce conflict by neutralizing wording.
- Prevent abuse with rate limits and blocklist controls.

## Non-goals
- Anonymous reactions.
- Admin identity reveal path.

## Scope
- In: DM intake, sanitize/rewrite, posting, moderation guardrails.
- Out: full moderation panel UI.

## Interfaces and Contracts
- Bot command in DM: `/anon <message>` (or conversational prompt flow).
- Use-case: `PostAnonymousMessage`.
- Result includes posted message id and moderation outcome.

## Domain Rules
- Sender identity is never included in reposted content.
- Per-user cooldown and daily cap enforced.
- Blocklisted phrases reject or request rewrite.

## Data Model Changes
- `anonymous_messages`:
  - `household_id`
  - `submitted_by_member_id` (internal only)
  - `raw_text`
  - `sanitized_text`
  - `moderation_status`
  - `posted_message_id`
  - timestamps

## Security and Privacy
- Internal sender reference is never exposed via group features.
- PII minimization and retention policy documented.
- Abuse logging without public reveal.

## Observability
- Submission volume metrics.
- Rejection/acceptance rate metrics.
- Error logs for rewrite or post failures.

## Edge Cases and Failure Modes
- Message too short/too long.
- Spam bursts.
- Telegram post failure after rewrite.

## Test Plan
- Unit:
  - moderation and cooldown policy
  - anonymization invariants
- Integration:
  - DM ingestion to repost pipeline
- E2E:
  - anonymous submission lifecycle in test group

## Acceptance Criteria
- [ ] DM to group repost works end-to-end.
- [ ] Sender is hidden in group output.
- [ ] Rate limit and blocklist enforced.
- [ ] Sanitization pipeline tested.

## Rollout Plan
- Start with strict moderation thresholds and tune based on false positives.
