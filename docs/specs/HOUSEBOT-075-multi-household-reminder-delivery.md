# HOUSEBOT-075 Multi-Household Reminder Delivery

## Goal

Replace the current reminder placeholder path with a real multi-household reminder dispatcher.

## Problem

Current reminder jobs only claim a dedupe key and return `messageText`. They do not send any Telegram message. They also require a single global `HOUSEHOLD_ID`, which is incompatible with the bot's DB-backed multi-household model.

## Target behavior

- Scheduler endpoint accepts `utilities`, `rent-warning`, or `rent-due`
- For the target billing period, the bot resolves all configured household reminder targets from the database
- A household reminder target uses:
  - bound `reminders` topic if present
  - otherwise the household chat itself
- For each target household, the bot:
  - builds deterministic reminder text
  - claims dedupe for `(householdId, period, reminderType)`
  - posts the message to Telegram only when the claim succeeds
- Dry-run returns the planned dispatches without posting

## Delivery model

- Scheduler route remains a single endpoint per reminder type
- One request fan-outs across all reminder-enabled households
- Logs include an entry per household outcome

## Data source

Household config comes from `HouseholdConfigurationRepository`:

- household chat binding is required
- reminder topic binding is optional

## Runtime contract

Reminder jobs require:

- `DATABASE_URL`
- one scheduler auth mechanism (`SCHEDULER_SHARED_SECRET` or allowed OIDC service accounts)

Reminder jobs must not require:

- `HOUSEHOLD_ID`
- group/topic reminder env vars

## Follow-ups

- daily scheduler cadence in infrastructure defaults
- localized reminder copy using persisted household/member locale
- scheduler fan-out observability metrics
