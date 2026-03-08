# ADR-003: Database-Backed Multi-Household Telegram Configuration

## Status

Accepted

Decision Date: 2026-03-09
Owners: Stanislav Kalishin

## Context

The current runtime assumes one household per deployment. `HOUSEHOLD_ID`,
`TELEGRAM_HOUSEHOLD_CHAT_ID`, `TELEGRAM_PURCHASE_TOPIC_ID`, and
`TELEGRAM_FEEDBACK_TOPIC_ID` are injected as environment variables and then used
globally by the bot.

That model is not viable for the intended product:

- one bot should support multiple Telegram groups
- onboarding should not require Terraform edits or redeploys
- topic ids should be captured from real Telegram updates, not copied manually
- mini app and bot features must resolve household context per chat/member

## Decision

Move household Telegram configuration out of environment variables and into the
application database.

Keep environment variables only for deployment-global concerns:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `DATABASE_URL`
- scheduler auth settings
- logging and infrastructure settings

Persist household-specific Telegram configuration as data:

- Telegram group/supergroup chat id
- topic bindings by role (`purchase`, `feedback`, later `reminders`)
- household state and setup status
- member-to-household Telegram identity linkage

Bootstrap household setup through bot interactions:

- bot added to a Telegram group
- admin runs `/setup`
- admin runs topic binding commands inside target topics
- members DM `/start` to link their Telegram identity

## Boundary Rules

- Domain stays unaware of Telegram ids and setup flows.
- Application owns setup use-cases and authorization rules.
- Ports expose household configuration and membership repositories.
- Telegram-specific extraction of chat ids, topic ids, and admin checks remains
  in adapters/app entrypoints.

## Data Model Direction

Add database-backed configuration entities around the existing `households`
table, likely including:

- `telegram_households` or equivalent mapping from Telegram chat to household
- `household_topics` keyed by household + role
- richer `members` onboarding/link status fields if needed

Exact table shapes remain implementation work, but the model must support:

- many Telegram groups per deployment
- unique chat id ownership
- unique topic role per household
- idempotent setup commands

## Rationale

- Removes deploy-time coupling between infrastructure and household onboarding.
- Matches real Telegram behavior, where chat and topic identifiers are only
  known after bot interaction.
- Keeps the production architecture aligned with a multi-tenant SaaS model.
- Simplifies future mini app settings screens because configuration is already
  stored as data.

## Consequences

Positive:

- one deployed bot can support many households
- onboarding is self-serve through Telegram commands and later mini app UI
- infrastructure configuration becomes smaller and safer

Negative:

- requires schema changes and migration from the current single-household model
- setup authorization rules become a real application concern
- finance/reminder flows must resolve household context dynamically

## Risks and Mitigations

Risk:

- Mixing old env-based household logic with new DB-backed logic creates an
  inconsistent runtime.

Mitigation:

- Introduce an explicit migration phase with fallback rules documented in the
  spec.
- Remove household-specific env usage after setup flows are shipped.

Risk:

- Unauthorized users could bind topics or hijack setup.

Mitigation:

- Require Telegram group admin privileges for setup and topic binding commands.
- Persist an owning admin/member relation and audit setup actions.
