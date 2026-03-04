# Household Bot Roadmap

## Vision

Build a clean, modular Telegram household finance platform with a mini app, designed for real use and portfolio-grade engineering quality.

## Principles

- Hexagonal architecture with strict ports/adapters boundaries.
- Small, composable modules and strong type safety.
- Incremental delivery with small commits and always-green CI.
- Money-safe calculations (integer minor units only).
- Pragmatic v1, explicit enterprise extensions in later phases.

## Phase 0 - Foundation

Goal: establish architecture, tooling, and delivery guardrails.

Deliverables:

- Bun workspace monorepo layout.
- TypeScript strict base config.
- Oxlint setup and formatting conventions (no semicolons).
- CI pipeline for typecheck, lint, tests, and build.
- Initial ADRs and spec template.

Exit criteria:

- Fresh clone can run quality checks with one command.
- CI passes on default branch.
- Architecture boundaries are documented.

## Phase 1 - Finance Core

Goal: implement deterministic domain logic for monthly settlements.

Deliverables:

- Domain value objects (`Money`, `BillingPeriod`, IDs).
- Settlement engine for rent + utility + purchase offsets.
- Default equal utility split, with optional day-based override.
- Domain unit tests covering edge cases.

Exit criteria:

- Settlement logic is adapter-independent.
- Domain test suite covers normal and failure paths.

## Phase 2 - Telegram Bot Core

Goal: process household activity and manage billing cycles in Telegram.

Deliverables:

- grammY bot webhook service.
- Topic listener for `Общие покупки`.
- Utility and rent commands.
- Billing cycle commands and statements.
- Idempotent message processing.

Exit criteria:

- Purchase messages are ingested and persisted.
- Monthly statement can be produced via command.

## Phase 3 - Reminders and Scheduling

Goal: automate key payment reminders.

Deliverables:

- Cloud Scheduler jobs.
- Reminder handlers for day 3/4 utilities, day 17 rent notice, day 20 due date.
- Dedicated topic posting for reminders.

Exit criteria:

- Scheduled reminders fire reliably.
- Duplicate sends are prevented.

## Phase 4 - Mini App V1

Goal: deliver a usable household dashboard.

Deliverables:

- SolidJS mini app shell.
- Telegram initData verification and membership gate.
- Ledger view, balances, and settlement preview.
- RU/EN localization.

Exit criteria:

- Active group members can view current month balances.
- Financial views are consistent with bot calculations.

## Phase 5 - Anonymous Feedback + Safety

Goal: support safer household communication.

Deliverables:

- Anonymous DM flow to bot.
- Sanitized/rephrased repost to group topic.
- Rate limits and blocklist moderation.

Exit criteria:

- Sender identity is hidden from group users.
- Abuse controls prevent spam and obvious misuse.

## Phase 6 - Hardening and Portfolio Polish

Goal: production readiness and strong showcase quality.

Deliverables:

- Sentry integration and structured logging.
- Integration and end-to-end tests.
- Runbooks and operational docs.
- Architecture diagram and demo instructions.

Exit criteria:

- Incident/debug workflow is documented.
- Repo can be reviewed as a coherent system design case study.

## Deferred (Post-v1)

- House wiki pages (Wi-Fi, rules, how-to).
- Cleaning/karma workflow.
- Advanced analytics and trend insights.
- Prometheus/Grafana/Kubernetes stack.
