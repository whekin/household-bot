# HOUSEBOT-097: Mini app startup and read performance

## Summary

Make the authenticated mini app useful within a target of 2–3 seconds on a normal
connection, instead of the reported 10–15 seconds behind a loading indicator.
Reduce avoidable work across the initial bundle, HTTP requests, and finance reads.

## Goals

- Reduce initial JavaScript and unnecessary requests before the home screen is usable.
- Bound database work as billing history grows and remove repeated reads within a request.
- Keep authentication, accounting, and concurrent materialization behavior correct.
- Make loading failures recoverable and expose useful request timing diagnostics.

## Scope

- In: frontend startup, lazy views, read/query lifecycle, static caching, CORS preflight,
  dashboard assembly, finance read budgets, and regression coverage.
- Out: financial formula changes, production financial writes, infrastructure migration,
  public caching of household responses, and removal of local OMX artifacts.

## Interfaces and Contracts

- Preserve existing authenticated mini app API shapes and membership verification.
- Cache only static content and CORS preflight permission; household API data stays private.
- Supplementary dashboard reads may overlap independent work. History must observe any
  cycle/snapshot materialization completed while generating the dashboard.
- Do not automatically retry financial writes or make an aborted client request imply rollback.

## Domain Rules

- Money remains exact in minor units, with unchanged deterministic splits.
- Fresh writes must invalidate any reused reads; no cross-request stale finance cache.
- Departed/away member rules, payment attribution, purchase carryover, history, and
  concurrent snapshot revision protection remain intact.

## Observability

- Retain structured request duration and repository-call metrics.
- Use response timing diagnostics to distinguish network time from server work.
- Repository-call counts are adapter method counts, not literal SQL statement counts.

## Test Plan

- Regression tests for independent dashboard reads and preserved history ordering.
- Query-budget tests using realistic cycle history and repeated reads.
- Auth/CORS and client failure/retry coverage.
- Build size comparison and browser smoke checks where the environment permits.
- Repository pre-commit/pre-push checks and Codex review before any merge.

## Acceptance Criteria

- [x] Measured initial JavaScript reduction and unnecessary startup requests removed.
- [x] Dashboard query budget improves with unchanged accounting results.
- [x] Dashboard errors leave a recoverable screen instead of indefinite loading.
- [x] Existing tests and required repository quality checks pass.
- [ ] Production Telegram opening time is measured after an approved release; the 2–3
      second target is not claimed from local or unauthenticated measurements alone.

## Rollout Plan

Prepare and validate locally. Commit, push, and release require the user's authorization.
After release, inspect request durations/call counts and authenticated Telegram open times.
