# Kojori Household Bot

Portfolio-grade Telegram household bot and mini app for shared rent, utilities, purchases, reminders, and lightweight household administration.

The product is built for real group-chat usage: housemates talk in Telegram topics, the bot turns structured messages into deterministic finance records, and the mini app provides a clearer monthly balance view when chat is no longer enough.

## What This Repo Shows

This is not a toy Telegram bot repo with a thin webhook and some string parsing. The interesting parts are:

- deterministic money-safe settlement logic with integer minor-unit math
- a hexagonal TypeScript monorepo with explicit domain / application / ports / adapter boundaries
- real operational concerns: idempotency, onboarding flows, localized UX, bot topic setup, reminder scheduling, Terraform-managed infrastructure
- a product that mixes structured command flows with LLM-assisted parsing while keeping writes deterministic

## Current Product Scope

Implemented today:

- Telegram group onboarding with `/setup`, topic binding, and `/unsetup`
- topic-based ingestion for purchases, payments, reminders, and anonymous feedback
- DM assistant with household-aware context, payment confirmation flow, and tagged replies in group topics
- deterministic household accounting for rent, utilities, purchases, payments, lifecycle status, and absence policy handling
- mini app authentication, member/admin controls, ledger view, balance dashboard, and household settings
- GCP deployment baseline with Cloud Run, Cloud Scheduler, Secret Manager, Artifact Registry, and Terraform-managed alerting

Still evolving:

- richer mini app finance visualizations
- more advanced setup automation
- deeper member lifecycle and billing policy UX
- broader operational tooling beyond the current alerting baseline

The roadmap and specs are linked below. The README stays intentionally honest: it highlights what is already implemented in code, not everything that is planned.

## Architecture

The repo uses a hexagonal structure:

- `packages/domain`: pure business rules and value objects
- `packages/application`: use cases and orchestration logic
- `packages/ports`: external interfaces
- `packages/adapters-*`: concrete persistence/integration adapters
- `apps/bot`: grammY delivery layer and bot workflows
- `apps/miniapp`: SolidJS front-end for richer household admin and finance views

Core invariants:

- no floating-point money math
- store and calculate monetary values in minor units
- keep settlement behavior deterministic
- persist raw parsed purchase text and parser metadata for traceability

## Stack

- Bun workspaces
- TypeScript with strict settings and native `tsgo` typechecking
- grammY for Telegram bot delivery
- SolidJS + Vite for the mini app
- Drizzle for schema and persistence layer
- Terraform for GCP infrastructure
- Oxlint + Oxfmt + Lefthook for local quality gates

## Monorepo Layout

```text
apps/
  bot/        Telegram bot delivery, commands, topic ingestion, mini app HTTP handlers
  miniapp/    SolidJS web app for balances, ledger, and household admin

packages/
  domain/         Money, billing periods, IDs, domain rules
  application/    Use cases and orchestration services
  ports/          Interfaces for repositories and integrations
  adapters-db/    Drizzle/Postgres adapter implementations
  db/             Schema, migrations, seed logic
  config/         Shared runtime config parsing
  observability/  Logging and instrumentation helpers

docs/
  roadmap.md
  specs/
  decisions/
  runbooks/
```

## Local Development

Install dependencies:

```bash
bun install
```

Run the main quality gates:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Run the bot and mini app locally:

```bash
bun run dev:bot
bun run dev:miniapp
```

Database and migration helpers:

```bash
bun run db:generate
bun run db:migrate
bun run db:seed
```

Infrastructure validation:

```bash
bun run infra:fmt:check
bun run infra:validate
```

Container smoke flow:

```bash
bun run docker:build
bun run docker:smoke
```

For a fuller setup walkthrough, see the [development setup runbook](docs/runbooks/dev-setup.md).

## Engineering Notes

Some product choices here are intentional:

- LLMs help interpret messy purchase/payment phrasing, but final writes are still explicit, structured, and confirmable.
- Topic-specific ingestion stays separate from the general assistant so finance actions do not degrade into vague chat behavior.
- Telegram UX is treated as a real product surface: onboarding, confirmation buttons, topic setup, tagged replies, and localization are part of the design, not afterthoughts.
- Infra is versioned alongside the app so deployability, alerts, and runtime configuration are reviewable in the same repo.

## Read More

- [Roadmap](docs/roadmap.md)
- [Specs guide](docs/specs/README.md)
- [Architecture decisions](docs/decisions)
- [Runbooks](docs/runbooks)

## Status

This repository is actively developed and intentionally structured as both:

- a real household-finance product in progress
- a representative engineering sample that shows system design, delivery discipline, and product-minded backend/frontend work in one codebase
