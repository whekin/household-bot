# Mini app performance

Spec: [HOUSEBOT-097](../specs/HOUSEBOT-097-miniapp-performance.md).

The target is a useful authenticated Home screen within 2–3 seconds on a normal
connection. Measure until balances and payment actions appear, not just the loading
indicator or Telegram's `ready()` call. Public HTML/health probes do not measure this.

## Local results — 2026-10-08

| Check                                               | Before                                         | After                                         |
| --------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Initial JavaScript                                  | 597.66 KB / 167.48 KB gzip                     | 471.01 KB / 139.52 KB gzip                    |
| Admin Home API requests                             | Session, dashboard, three admin reads          | Session and dashboard                         |
| Frozen archive, 18 cycles                           | 23 repository calls                            | 4 repository calls; one joined snapshot query |
| Failed external FX lookup                           | 15.9-second retry policy; body timeout missing | Approximately 2.1 seconds, including body     |
| Allocation fixture, 250 purchases / 500 allocations | 500,000 allocation ID visits                   | 500 visits                                    |

An unchanged default dashboard performs no lifecycle writes and stays within a
15-call finance-repository budget in the simple regression fixture. Sequential and
overlapping operation tests verify cached reads do not leak across calls.

All repository hooks passed, including migrated disposable PostgreSQL 17 tests;
31 focused database regressions passed separately. Browser fixtures verified cold
Home requests, deferred tabs, SDK/config ordering, dashboard retry, delayed editor
readiness, and failed-chunk recovery. Real Nginx verified caching/compression and
uncached missing assets. These measurements do not establish production Telegram
opening time. Local validation used Bun 1.4.2 from PATH; deployment pins 1.3.10.

## Diagnose a slow open

1. Inspect `http.request_handled` logs for `/api/miniapp/session` and
   `/api/miniapp/dashboard`: `durationMs`, `queryCount`, `queryMs`, and `byMethod`.
2. Inspect the browser network timeline, including Telegram's SDK, config, JavaScript,
   preflight requests, and API bodies. Home should request only session and dashboard;
   admin reads and Activity/Settings chunks start when those tabs open.
3. Inspect API `Server-Timing`: `app` is request wall time, `repo` is summed repository
   call time, and `repo_calls` is the number of repository calls. Concurrent call times
   may add up to more than wall time; calls are not individual SQL statements. Timing
   details are exposed to the existing allowed mini app origin.
4. Correlate missing-rate delays with `fx.nbg_retry` / `fx.nbg_failed`. Two complete
   one-second attempts plus a 100 ms delay bound the normal failure budget to about
   2.1 seconds per external currency lookup. Locked cycle rates bypass the provider.
   A stored actual quote remains the only fallback; absent quotes still fail explicitly.

Dashboard generation can materialize plans, snapshots, and cycle transitions. Use
existing request logs for production measurements. Run full repeatable dashboard
benchmarks against a disposable/restored database; use read-only SQL/EXPLAIN for live
database inspection.

## Regression checks

```bash
DATABASE_URL='' bun test packages/application/src/finance-command-service.test.ts -t 'finance read budgets'
DATABASE_URL='' bun test apps/bot/src/nbg-exchange-rates.test.ts apps/bot/src/miniapp-dashboard.test.ts apps/bot/src/miniapp-auth.test.ts apps/bot/src/miniapp-timing.test.ts
DATABASE_URL='' bun test apps/miniapp/src/api/client.test.ts
```

Database regressions require migrated, disposable PostgreSQL 17. Set
`UTILITY_IMPORT_TEST_DATABASE_URL` for financial-consistency/late-bill suites, and
`DATABASE_URL` plus `RUN_DB_INTEGRATION_TESTS=1` for adapter tests. Explicit environment
values prevent Bun from loading a production URL from the repository's local `.env`.

## Release verification

- Compare cold and warm Telegram launches for both resident and admin accounts.
- Verify switching to Activity, Settings, and Routines, including direct tab links.
- Check current balances after a purchase/payment change and after period rollover.
- Test offline/failed reads: a recoverable error must replace indefinite loading.
- Check hashed assets have immutable caching; HTML revalidates and runtime config
  stays uncached. Missing assets must return 404 without immutable caching.
- Record device, connection, commit, and several authenticated open times before
  declaring the 2–3 second target achieved.
