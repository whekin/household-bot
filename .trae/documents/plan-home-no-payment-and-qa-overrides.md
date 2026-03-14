# Plan: Fix Home “No Payment” + Add QA Period Overrides

## Goals

- Remove the “Due” chip from the **No payment period** card.
- In **No payment period**, don’t show rent/utilities balances; show only purchase-related balance and household info (FX if available).
- Fix “Upcoming” dates so they never show negative days (e.g., “-11d left”); if the reminder/warning already passed in the current period, show the next period’s start date instead.
- Add **period/date overrides** to the hidden QA “Testing view” so you can reliably test all Home variants.

## Changes

### 1) Home: remove “Due” chip from No-payment card

- In [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx), stop rendering the `focusBadge()` inside the `mode() === 'none'` card.
- Keep the existing Due/Settled chip behavior for utilities/rent modes unchanged.

### 2) Home: No-payment mode shows purchases-only balance

- In [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx):
  - When `homeMode() === 'none'`, hide the current “Your balance” card (which includes rent + utilities).
  - Replace it with a purchases-focused card that shows:
    - Member purchase offset (from `currentMemberLine().purchaseOffsetMajor`) as the primary amount.
    - Household purchase totals (count + sum) computed from the existing dashboard ledger entries where `kind === 'purchase'`.
    - Household member count (from dashboard member lines length).
  - Keep household informational cards that are not “due/balance for rent/utilities” (e.g., the FX card if present/available).

### 3) Home: Upcoming utilities/rent start date never goes negative

- Update upcoming calculations in No-payment mode:
  - If `daysUntilPeriodDay(period, reminderDay, timezone)` is `>= 0`, show as-is.
  - If it is `< 0`, compute the next period (`BillingPeriod.fromString(period).next().toString()`) and compute:
    - `formatPeriodDay(nextPeriod, reminderDay, locale)`
    - `daysUntilPeriodDay(nextPeriod, reminderDay, timezone)`
  - Apply the same logic for rent warning day and utilities reminder day.
- This ensures “Utilities starts …” always points to a future date and shows a non-negative countdown.

### 4) QA Testing View: add period/date overrides

- Extend the existing hidden “Testing view” (opened by 5 taps on the role badge) in:
  - [shell.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/components/layout/shell.tsx)
  - [dashboard-context.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx)
- Add two optional overrides stored in `DashboardContext`:
  - `testingPeriodOverride?: string | null` (format `YYYY-MM`)
  - `testingTodayOverride?: string | null` (format `YYYY-MM-DD`)
- Home uses `effectivePeriod = testingPeriodOverride ?? dashboard.period`.
- Date helpers used by Home (`daysUntilPeriodDay`, `compareTodayToPeriodDay`) accept an optional “today override” so Home can behave as if it’s a different day without changing system time.

### 5) Copy updates

- Add/adjust i18n strings needed for the purchases-only card and QA fields in:
  - [i18n.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/i18n.ts)

## Verification

- Run: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`
- Manual checks in miniapp:
  - Set QA overrides to land inside utilities window / rent window / no-payment window and confirm Home variant changes.
  - Confirm no-payment “Upcoming” countdown never shows negative values.
  - Confirm no-payment mode hides rent/utilities balance and no longer shows “Due” chip on that card.
  - Confirm no-payment mode shows purchase offset + household purchase stats + member count.
