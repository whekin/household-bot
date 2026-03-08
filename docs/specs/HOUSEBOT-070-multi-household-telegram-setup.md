# HOUSEBOT-070: Multi-Household Telegram Setup and Configuration

## Summary

Replace the current single-household env configuration with database-backed
household registration, topic binding, and member onboarding so one deployed bot
can serve multiple Telegram groups.

## Goals

- Register a household from a real Telegram group without redeploying
- Bind purchase and feedback topics from in-topic admin commands
- Link real Telegram users to household members through DM onboarding
- Resolve household context dynamically in bot and mini app flows

## Non-goals

- Full settings UI in the mini app
- Multi-household reminders customization beyond topic role binding
- Cross-household user accounts beyond Telegram identity linkage

## Scope

- In:
  - group bootstrap command
  - topic binding commands
  - persistent Telegram chat/topic configuration
  - member DM onboarding and pending linkage flow
  - migration away from global household/topic env vars
- Out:
  - advanced role management UI
  - invite links and QR onboarding
  - reminders topic configuration UI

## Interfaces and Contracts

Telegram commands:

- `/setup`
- `/bind_purchase_topic`
- `/bind_feedback_topic`
- `/status`
- `/start`

Expected command behavior:

- `/setup` in a group:
  - creates or reuses a household bound to `chat.id`
  - records setup initiator
  - returns current setup state
- `/bind_purchase_topic` in a topic:
  - stores `message.chat.id` + `message.message_thread_id` as purchase topic
- `/bind_feedback_topic` in a topic:
  - stores `message.chat.id` + `message.message_thread_id` as feedback topic
- `/start` in DM:
  - records Telegram identity
  - lists pending household memberships or onboarding status

Mini app/API implications:

- session resolution must locate the caller’s household membership from stored
  membership data, not a deployment-global `HOUSEHOLD_ID`
- household dashboard endpoints must accept or derive household context safely

## Domain Rules

- One Telegram group chat maps to exactly one household
- Topic role binding is unique per household and role
- Only Telegram group admins can run setup and topic binding commands
- Topic binding commands must be executed inside a topic message thread
- Setup commands are idempotent
- Member linkage must use the caller’s actual Telegram user id

## Data Model Changes

Add tables or equivalent structures for:

- household-to-Telegram chat mapping
- topic bindings by household and role
- member onboarding/link status if current `members` shape is insufficient

Indexes/constraints should cover:

- unique Telegram chat id
- unique `(household_id, role)` for topic bindings
- unique `(household_id, telegram_user_id)` for members

Migration direction:

- keep current `households` and `members`
- backfill the existing demo household into the new config model if useful for
  development
- remove runtime dependency on household/topic env vars after cutover

## Security and Privacy

- Verify group admin status before setup mutations
- Reject topic binding attempts outside the target group/topic
- Log setup and binding actions with actor Telegram id
- Do not expose household membership data across households
- Keep anonymous feedback sender privacy unchanged

## Observability

Required logs:

- household setup started/completed
- topic binding created/updated
- member onboarding started/linked
- rejected setup attempts with reason

Useful metrics:

- setup command success/failure count
- topic binding count by role
- unlinked member count

## Edge Cases and Failure Modes

- Bot added to a group without admin permissions
- Bot present in a group with privacy mode still enabled
- Topic binding command sent in main chat instead of a topic
- Duplicate `/setup` on an already configured household
- Member DMs `/start` before the household exists
- Same Telegram user belongs to multiple households

## Test Plan

- Unit:
  - setup authorization rules
  - topic binding validation
  - member link resolution rules
- Integration:
  - repository operations for chat/topic binding persistence
  - Telegram command handlers with realistic update payloads
- E2E:
  - group setup -> topic binding -> member DM onboarding -> command success

## Acceptance Criteria

- [ ] Bot can create or load household config from a group `/setup` command
- [ ] Admin can bind the purchase topic without manual id lookup
- [ ] Admin can bind the feedback topic without manual id lookup
- [ ] Member DM onboarding stores real Telegram user identity for later linkage
- [ ] Existing finance and feedback flows can resolve household context from DB
- [ ] Household-specific env vars are no longer required in deployed runtime

## Rollout Plan

- Add new schema and repositories first
- Ship setup and topic binding commands behind the existing bot deployment
- Migrate bot runtime reads from env vars to DB-backed config
- Remove household/topic env vars from Terraform examples and runbooks after
  cutover
