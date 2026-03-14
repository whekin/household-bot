# Plan: Miniapp Home “Current Period” + Rent Credentials

## Summary

Implement a “current payment period” focused Home screen with three modes:

- **Utilities period** (between utilities reminder day and utilities due day, inclusive)
- **Rent period** (between rent warning day and rent due day, inclusive)
- **No payment period** (everything else)

Add **rent payment credentials** (one-or-more destinations) to the backend + database, editable by admins and visible to all members. Also add a **resident-accessible utility bill submission** flow surfaced on Home during the utilities window when no utility bills are recorded yet.

## Current State Analysis (repo-grounded)

### Miniapp UI and data flow

- Home route today is a single view rendering “Your balance”, optional rent FX, and latest activity, driven by `MiniAppDashboard` from `DashboardContext`.
  - [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx#L1-L178)
  - [dashboard-context.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx#L240-L366)
- `MiniAppDashboard` already carries `period`, `timezone`, `rentDueDay`, `utilitiesDueDay`, and `paymentBalanceAdjustmentPolicy`, but **does not include** `rentWarningDay` / `utilitiesReminderDay` or any payment destinations.
  - [miniapp-api.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/miniapp-api.ts#L95-L143)
- Date helpers exist to compare “today in timezone” against a day inside a given `period` and to compute days remaining.
  - [dates.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/lib/dates.ts#L105-L172)

### Backend / domain

- Miniapp dashboard API maps `FinanceCommandService.generateDashboard()` into `MiniAppDashboard`.
  - [miniapp-dashboard.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/miniapp-dashboard.ts#L12-L150)
- `FinanceDashboard` is built from billing settings + cycle state; it uses `rentWarningDay` and `utilitiesReminderDay` internally for FX lock dates, but it currently only exposes `rentDueDay` and `utilitiesDueDay` to the miniapp.
  - [finance-command-service.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/application/src/finance-command-service.ts#L287-L599)
- Billing settings are persisted in Postgres via Drizzle table `household_billing_settings` (already includes rent/utilities due and reminder/warning days + timezone).
  - [schema.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/db/src/schema.ts#L24-L50)
  - Repository accessors: [household-config-repository.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/adapters-db/src/household-config-repository.ts#L944-L1066)
- Utility bills are currently **admin-only** in the miniapp (`/api/miniapp/admin/utility-bills/add`) and the UI hides add/edit behind `effectiveIsAdmin()`.
  - UI: [ledger.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/ledger.tsx#L617-L652)
  - API handler: [miniapp-billing.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/miniapp-billing.ts#L721-L790)

## Proposed Changes (decision-complete)

### 1) Add rent payment destinations to DB + ports

**Decision:** store rent credentials as a JSON array on `household_billing_settings` to support multiple destinations without introducing a new table (pre-1.0 simplicity + cohesion with billing config).

- Add a new `jsonb` column on `household_billing_settings`:
  - `rent_payment_destinations` (nullable, default `null`)
- Add a strongly-typed record shape in ports:
  - `HouseholdRentPaymentDestination`:
    - `label: string` (e.g., “TBC card”, “Bank transfer”)
    - `recipientName: string | null`
    - `bankName: string | null`
    - `account: string` (account number / card number / IBAN; stored as plain text)
    - `note: string | null`
    - `link: string | null` (optional URL/deeplink)
  - Add `rentPaymentDestinations?: readonly HouseholdRentPaymentDestination[] | null` to `HouseholdBillingSettingsRecord` and the `updateHouseholdBillingSettings` input.

Files:

- DB schema + migration:
  - [schema.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/db/src/schema.ts)
  - `packages/db/drizzle/00xx_*.sql` (new migration)
- Ports:
  - [household-config.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/ports/src/household-config.ts)
- DB adapter mapping:
  - [household-config-repository.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/adapters-db/src/household-config-repository.ts#L944-L1066)

### 2) Expose needed fields to the miniapp dashboard contract

**Goal:** let the miniapp compute “current period” locally and render period-specific UI consistently.

- Extend `FinanceDashboard` to include:
  - `rentWarningDay`
  - `utilitiesReminderDay`
  - `rentPaymentDestinations`
- Return these from `buildFinanceDashboard(...)` using the persisted billing settings.
- Extend bot miniapp dashboard handler serialization:
  - Include those fields in the `dashboard` JSON payload.
- Extend miniapp client types:
  - `MiniAppDashboard` adds `rentWarningDay`, `utilitiesReminderDay`, and `rentPaymentDestinations`.
- Update demo fixtures so the miniapp still renders in demo mode.

Files:

- Application:
  - [finance-command-service.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/application/src/finance-command-service.ts)
- Bot:
  - [miniapp-dashboard.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/miniapp-dashboard.ts)
- Miniapp API types + demo:
  - [miniapp-api.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/miniapp-api.ts)
  - [miniapp-demo.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/demo/miniapp-demo.ts)

### 3) Add admin editing UI for rent payment destinations

**Decision:** rent credentials are visible to everyone, but **only admins can edit** (implemented in Settings screen next to other billing settings).

- Extend the Settings “Billing settings” modal form state to include a list editor:
  - Add destination
  - Remove destination
  - Edit fields (label, recipient, bank, account, note, link)
- Extend `updateMiniAppBillingSettings(...)` request/response types to carry the new field.
- Extend backend handler that parses settings update payload and calls `updateHouseholdBillingSettings`.

Files:

- Miniapp:
  - [settings.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/settings.tsx)
  - [miniapp-api.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/miniapp-api.ts) (`MiniAppBillingSettings` + `updateMiniAppBillingSettings`)
  - [i18n.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/i18n.ts) (new strings)
- Bot:
  - [miniapp-admin.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/miniapp-admin.ts) (payload parsing)
- Application:
  - [miniapp-admin-service.ts](file:///Users/whekin/Projects/kojori-tg-bot/packages/application/src/miniapp-admin-service.ts) (include field into repository update input)

### 4) Implement “3 versions of Home” (utilities / rent / no payment)

**Decision:** Home determines an active mode as “Reminder→Due” (inclusive). It uses:

- `dashboard.period`
- `dashboard.timezone`
- `dashboard.utilitiesReminderDay` / `dashboard.utilitiesDueDay`
- `dashboard.rentWarningDay` / `dashboard.rentDueDay`

#### 4.1 Utilities mode

- Show a primary “Utilities” card:
  - Amount to pay = utilities base share + purchase offset if policy is `utilities`
  - Show due date and days left using existing copy keys (`dueOnLabel`, `daysLeftLabel`, etc.)
- If **no utility bills recorded yet** (`utilityLedger().length === 0`):
  - Show an inline “Fill utilities” call-to-action:
    - A simple add-utility-bill form embedded on Home (visible to all members).
    - After successful submission + refresh, the CTA disappears and the normal utilities card renders.
  - Optional: provide a link to the Ledger screen as fallback (if the user prefers to do it there).

#### 4.2 Rent mode

- Show a primary “Rent” card:
  - Amount to pay = rent base share + purchase offset if policy is `rent`
  - Show due date and days left/overdue visuals.
- Show one-or-more “Payment destination” cards listing:
  - Label, recipient, bank, account, note/link

#### 4.3 No payment mode

- Show an “Upcoming” card:
  - Days until utilities reminder day
  - Days until rent warning day
- Continue to show “Your balance” and latest activity as secondary content (so the screen stays useful).

Files:

- [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx)
- Potentially add a tiny helper in `apps/miniapp/src/lib/` for `computeHomePeriodMode(...)` if Home gets too large.
- [i18n.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/i18n.ts) (strings for new cards/actions)

### 5) Allow non-admin utility bill submission (for Home CTA)

**Decision:** add a new miniapp endpoint that allows any authorized member to add a utility bill, used by the Home CTA. Admin endpoints remain unchanged for editing/deleting.

- Add a new bot handler:
  - `POST /api/miniapp/utility-bills/add` (name can be finalized during implementation)
  - Auth: authorized member session required
  - Action: call `FinanceCommandService.addUtilityBill(billName, amountMajor, memberId, currency)`
  - Response: `{ ok, authorized, cycleState }` or `{ ok, error }`
- Wire it into the bot server router.
- Add a miniapp client function to call it (parallel to `addMiniAppUtilityBill`, but non-admin path).
- Home CTA uses this endpoint, then triggers `refreshHouseholdData(true, true)` so the dashboard updates.

Files:

- Bot:
  - [miniapp-billing.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/miniapp-billing.ts) (new handler)
  - [server.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/server.ts) (new route option + dispatch)
  - [index.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/bot/src/index.ts) (compose and pass the new handler into `createBotWebhookServer`)
- Miniapp:
  - [miniapp-api.ts](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/miniapp-api.ts) (new function)
  - [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx) (use it)

## Assumptions & Decisions

- Period selection is **Reminder→Due inclusive** (utilities: `utilitiesReminderDay..utilitiesDueDay`, rent: `rentWarningDay..rentDueDay`).
- Rent payment credentials are **structured** and stored as **plain text** fields (no secrets); they are visible to all household members and editable by admins only.
- Utilities “fill” flow is initially “rent-only credentials now”; utilities destinations are out of scope.
- Utility bill submission from Home is allowed for any authorized member; edit/delete remains admin-only.

## Verification Steps

- Typecheck, lint, test, build (repo quality gates):
  - `bun run format:check`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
- Manual miniapp checks:
  - Home renders correctly in all 3 modes by adjusting due/reminder days in Settings.
  - Utilities window + no bills: Home CTA allows submission and then switches to normal utilities view after refresh.
  - Rent window: rent credentials render correctly; multiple destinations show; admin edits persist and reload.
