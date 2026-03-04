# ADR-002: Hexagonal Architecture (Ports and Adapters)

## Status
Accepted

## Context
The project combines domain-heavy finance logic, Telegram integration, mini-app APIs, and scheduled jobs. Without strict boundaries, framework and infrastructure concerns will leak into core logic.

## Decision
Adopt hexagonal architecture with explicit layers:
- Domain: pure business model and invariants.
- Application: use-case orchestration.
- Ports: interfaces for repositories/services.
- Adapters: Telegram, DB, LLM, scheduler, HTTP.
- Composition root: runtime wiring only.

## Boundary Rules
- Domain cannot import adapters, SDKs, HTTP, or SQL clients.
- Application cannot import concrete adapter implementations.
- Adapters can depend on SDKs and infra concerns but must implement ports.
- Entry points create dependency graph and pass ports to use-cases.

## Module Layout
- `packages/domain`
- `packages/application`
- `packages/ports`
- `packages/adapters-*`
- `apps/*` for composition and delivery endpoints

## Rationale
- Keeps financial logic testable and framework-independent.
- Enables incremental replacement of adapters (e.g., parser provider).
- Supports clean growth from v1 to larger-scale architecture.

## Consequences
Positive:
- High maintainability and clear ownership of concerns.
- Better interview-readability of architecture.

Negative:
- Requires initial discipline and more explicit interfaces.
- Slight boilerplate overhead for small features.

## Risks and Mitigations
Risk:
- Overengineering through too many tiny abstractions.

Mitigation:
- Create ports only for external boundaries and meaningful seams.
- Keep use-cases focused; avoid generic base classes.
