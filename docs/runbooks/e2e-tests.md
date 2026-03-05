# End-to-End Smoke Tests

## Overview

The `scripts/e2e/billing-flow.ts` script runs a deterministic end-to-end
smoke test for the billing pipeline. It exercises:

- Purchase ingestion from a simulated topic message
- Utility bill entry via bot commands
- Monthly statement generation and balance verification

## Prerequisites

- Bun 1.3+ installed
- A running Supabase/Postgres database with the schema applied
- `DATABASE_URL` set (via `.env` or environment)
- `E2E_SMOKE_ALLOW_WRITE=true` set explicitly (safety guard)

## Running locally

```bash
# 1. Ensure .env has a valid DATABASE_URL
cp .env.example .env
# edit .env with real DATABASE_URL

# 2. Apply database migrations
bun run db:migrate

# 3. Run the e2e smoke test
E2E_SMOKE_ALLOW_WRITE=true bun run test:e2e
```

The test seeds its own data (household + 3 roommates), runs the full
purchase → utility → statement flow, asserts deterministic totals, and
cleans up after itself.

## Expected output

On success:

```text
E2E smoke passed: purchase ingestion, utility updates, and statements are deterministic
```

On failure the script exits with code 1 and prints the assertion error.

## CI integration

Run the e2e smoke test with `bun run test:e2e` locally or in a dedicated
CI job. If you wire it into CI, gate it on `DATABASE_URL` and
`E2E_SMOKE_ALLOW_WRITE` to avoid false failures. The test is **not**
part of the standard CI quality matrix by default.

## Test data

The test creates temporary records with random UUIDs:

| Entity    | Details                    |
| --------- | -------------------------- |
| Household | "E2E Smoke Household"      |
| Alice     | Admin, telegram ID 900001  |
| Bob       | Member, telegram ID 900002 |
| Carol     | Member, telegram ID 900003 |

All test data is cleaned up in a `finally` block via cascade delete on
the household row.
