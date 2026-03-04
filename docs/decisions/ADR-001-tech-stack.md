# ADR-001: V1 Tech Stack

## Status
Accepted

## Context
The project needs to be modern, modular, and scalable while still delivering v1 quickly.

## Decision
- Runtime/package manager/test runner: Bun
- Language: TypeScript (strict mode)
- Bot framework: grammY
- Database: Supabase Postgres
- Deployment runtime: Google Cloud Run
- Scheduling: Google Cloud Scheduler
- Frontend mini app: SolidJS (Vite SPA) + Tailwind
- Validation: Zod
- Linting: Oxlint
- Error tracking: Sentry
- Logging/metrics baseline: Cloud Logging/Monitoring

## Rationale
- Bun provides a fast unified developer workflow.
- grammY is TypeScript-friendly with strong middleware patterns.
- Supabase keeps SQL-first data modeling while reducing ops overhead.
- Cloud Run + Scheduler offers serverless simplicity and predictable scheduling.
- Solid SPA provides modern UI performance with lightweight runtime cost.
- Oxlint enables fast linting suitable for small-commit workflow.

## Consequences
Positive:
- Strong portfolio architecture with pragmatic service count.
- Clear path to production without heavy platform ops.

Negative:
- Some enterprise tooling (Prometheus/Grafana/K8s) is deferred.
- Serverless constraints require disciplined idempotency and stateless design.

## Alternatives Considered
- Fly.io runtime: good DX, but Cloud Run better matches serverless objective.
- Convex backend: strong DX, but SQL/reporting fit is weaker for financial ledger.
- Telegraf bot framework: mature ecosystem, but less desirable TS ergonomics.
