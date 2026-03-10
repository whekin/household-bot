# Development Reset

## Warning

This workflow is destructive for development data. Do not use it against any database you care about.

## Fixture refresh

`bun run db:seed` replaces the committed fixture household with a fresh multi-household-compatible dataset.

Use it when:

- you want current demo data without wiping the entire database
- you only need the seeded fixture household reset

## Full dev reset

Use a disposable local or dev database only.

Recommended flow:

1. point `DATABASE_URL` at a disposable database
2. recreate the database or reset the schema using your database host tooling
3. run `bun run db:migrate`
4. run `bun run db:seed`

## Notes

- The committed seed reflects the current product model: multi-household setup, GEL settlement, USD-denominated rent with locked FX, topic bindings, utility categories, and payment confirmations.
- If you need historical or household-specific fixtures, create them as separate scripts instead of editing old migrations or mutating the default seed ad hoc.
