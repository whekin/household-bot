# @household/miniapp

React + Vite + Tailwind CSS Telegram Mini App.

## Screens

- **Home** — what you pay now (or that you're all paid up), shared purchases, today's routines, recent activity
- **Month** — the house's utilities and rent: bills, who pays which part, who has paid; admin tools at the end
- **＋** — add a shared purchase, a utility bill, money you sent a housemate, or (admins) a payment
- **History** — everything that happened, grouped by day, plus closed months
- **House** — housemates, routines, your name/language/appearance, admin settings

## Develop

```bash
bun install
bun run dev
```

Outside Telegram the dev server runs in demo mode. Pick a state with `?scenario=`:
`utilities-due` (default), `rent-due`, `all-set`, `overdue`. Tap the household
name five times for the testing sheet (role preview, date overrides).

## Scripts

```bash
bun run dev
bun run build
bun run typecheck
bun run test
```
