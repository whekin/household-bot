# HOUSEBOT-083: Anonymous Topic Relay

## Summary

Allow a configured anonymous feedback topic to feel like a normal chat: when a member posts there, the bot copies the message back into the same topic as the bot and removes the original user-authored message.

## Goals

- Hide sender identity from topic history for direct messages posted in the anonymous feedback topic.
- Support regular text and Telegram-copyable media such as photos with captions.
- Avoid interfering with other configured household topics.

## Non-goals

- Perfect real-time anonymity before Telegram clients see or notify the original message.
- Anonymous moderation/reporting UI.
- Album regrouping for media groups.

## Scope

- In: configured `feedback` topic relay, bot-message loop prevention, command passthrough, copy-before-delete safety.
- Out: storage of relay audit records, identity reveal tooling, custom media rendering.

## Interfaces and Contracts

- Uses existing household topic binding role: `feedback`.
- Bot must be an admin with message delete permission.
- Bot must receive group messages in the topic.
- Telegram Bot API behavior:
  - `copyMessage` reposts as the bot without forward attribution.
  - `deleteMessage` removes the original after a successful copy.

## Domain Rules

- Messages outside the configured `feedback` topic are not relayed.
- Bot-authored messages are ignored to prevent loops.
- Slash commands are not relayed so command UX remains available.

## Security and Privacy

- This provides anonymous topic history, not perfect anonymity; clients may briefly see the original sender before deletion.
- Copy failure leaves the original in place to avoid data loss.
- Delete failure is logged because the copied anonymous message may coexist with the original.

## Edge Cases and Failure Modes

- Telegram may reject copying unsupported service messages.
- Telegram may reject deletion if the bot lacks admin permission or the message is no longer deletable.
- Media groups are copied per-message in the MVP.

## Test Plan

- Bot tests:
  - Text messages in `feedback` topic are copied and deleted.
  - Photo messages in `feedback` topic are copied and deleted.
  - Non-feedback topic messages continue to later handlers.

## Acceptance Criteria

- [x] Text relay works in the configured feedback topic.
- [x] Photo relay uses `copyMessage` rather than manual text repost.
- [x] Original user message is deleted after a successful copy.
- [x] Other topics are not consumed by the relay.
