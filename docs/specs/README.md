# Specs Guide

Each implementation ticket should have one spec file in `docs/specs/`.

## Naming

Use `HOUSEBOT-<id>-<slug>.md`.

Example:

- `HOUSEBOT-001-monorepo-bootstrap.md`

## Spec Template

```md
# <Title>

## Summary

Short description of the feature and user value.

## Goals

- ...

## Non-goals

- ...

## Scope

- In: ...
- Out: ...

## Interfaces and Contracts

- Commands/events/APIs involved.
- Input and output schemas.

## Domain Rules

- Business constraints and invariants.

## Data Model Changes

- Tables, fields, indexes, migrations.

## Security and Privacy

- Auth, authorization, PII handling, abuse prevention.

## Observability

- Required logs, metrics, traces, and alerts.

## Edge Cases and Failure Modes

- Invalid input
- External service failures
- Duplicate/retry behavior

## Test Plan

- Unit:
- Integration:
- E2E:

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Rollout Plan

- Feature flags / staged rollout / backout plan.
```

## Definition of Done

- Spec exists and matches implementation.
- Code follows architecture boundaries.
- Tests for new behavior are included and passing.
- Lint and typecheck pass in CI.
- Docs/ADR updates included if behavior or architecture changed.
- No TODOs without linked follow-up ticket.

## Boundary Rules (Hexagonal)

- `packages/domain` must not import framework/DB/HTTP code.
- `packages/application` depends only on domain + ports/contracts.
- `packages/adapters-*` implement ports and may depend on external SDKs.
- Wiring of concrete adapters happens only in app entrypoints.
