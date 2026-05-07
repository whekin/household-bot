# HOUSEBOT-081 Mini App Massive Refactor Plan

## Summary

Refactor the Telegram mini app into a clearer, calmer, more editorial product surface.

The current mini app already contains meaningful household workflows, but the UX feels heavier than it should because:

- route files are large and mix product logic, state orchestration, and presentation
- data mutations commonly trigger full dashboard reloads and shared loading states
- information architecture has grown from an initial shell/dashboard into a dense admin + accounting console
- the visual system is consistent but generic and too close to a dark "Supabase clone" aesthetic

This refactor keeps the domain behavior and API contracts, but restructures the UI, data flow, and screen hierarchy so the app feels immediate, intuitive, and purpose-built for Telegram.

## Why This Refactor Is Needed

### Product drift

The original mini app specs were intentionally narrow:

- shell and auth gate: [docs/specs/HOUSEBOT-040-miniapp-shell.md](/Users/whekin/Projects/kojori-tg-bot/docs/specs/HOUSEBOT-040-miniapp-shell.md)
- read-only dashboard: [docs/specs/HOUSEBOT-041-miniapp-finance-dashboard.md](/Users/whekin/Projects/kojori-tg-bot/docs/specs/HOUSEBOT-041-miniapp-finance-dashboard.md)
- later admin controls: [docs/specs/HOUSEBOT-076-miniapp-admin-billing-controls.md](/Users/whekin/Projects/kojori-tg-bot/docs/specs/HOUSEBOT-076-miniapp-admin-billing-controls.md)
- statement-style breakdown: [docs/specs/HOUSEBOT-078-miniapp-balance-breakdown.md](/Users/whekin/Projects/kojori-tg-bot/docs/specs/HOUSEBOT-078-miniapp-balance-breakdown.md)

The shipped app now combines all of those layers into the same mobile shell. That gives users power, but it also collapses "check my balance", "record a payment", "edit cycle rent", "manage categories", and "approve members" into one interaction model.

### Technical symptoms

- Global dashboard loading is controlled by a shared flag in [apps/miniapp/src/contexts/dashboard-context.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx), with `loadDashboardData()` setting `loading=true` for both first load and refresh paths.
- Mutations frequently call `refreshDashboardData()`, which invalidates multiple queries and reloads the whole household payload again.
- Buttons render inline spinners via [apps/miniapp/src/components/ui/button.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/components/ui/button.tsx), reinforcing a blocking "wait for save" feeling.
- Route modules are oversized:
  - [apps/miniapp/src/routes/home.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx)
  - [apps/miniapp/src/routes/settings.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/settings.tsx)
  - [apps/miniapp/src/routes/bills.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/bills.tsx)
  - [apps/miniapp/src/routes/purchases.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/purchases.tsx)
- Styling is centralized in a single very large stylesheet: [apps/miniapp/src/index.css](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/index.css)

## Current Mini App Overview

### Functional scope

The mini app currently supports:

- Telegram auth, membership gate, onboarding, and demo mode
- home dashboard with personal balance focus
- balance explanation and ledger derivation views
- bill entry, utility plan resolution, vendor payment recording, and rent editing
- purchase creation, editing, deletion, and split management
- manual payment recording and payment history
- household and personal settings
- admin member management and pending-member approvals
- utility category management
- assistant tone/context management
- hidden testing controls inside the live shell

This is already closer to a compact operating system for the household than a simple mini dashboard.

### Information architecture

Current top-level structure:

- `Home`
- `Balances`
- `Bills`
- `Purchases`
- `Settings` via top-right icon, not primary nav

Problems:

- "Home" is trying to be both summary and action center
- "Balances" and "Bills" overlap conceptually for ordinary members
- "Settings" hides major admin workflows behind a non-primary entry
- admin and resident surfaces are interleaved instead of intentionally separated
- there is no strong distinction between "today’s tasks", "records/history", and "household configuration"

### Design language

The current design is coherent but generic:

- explicit "Supabase-inspired dark theme with green accent" tokens in [apps/miniapp/src/theme.css](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/theme.css)
- `Inter` as the global typeface via [apps/miniapp/src/index.css](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/index.css)
- repeated glass cards, green accents, muted badges, and standard dashboard spacing

Problems:

- visually familiar, but not distinctive
- weak hierarchy between urgent actions, passive information, and admin tools
- too much of the experience feels like "panels on a dark page"
- interactions are competent but not memorable

## Recommended Product Direction

### Keep SolidJS

Do not migrate to React as the first move.

Reasons:

- the current problems are architectural and UX-related, not caused by Solid
- the app already uses Solid routing, signals, and a query client successfully
- a React migration would add cost, risk, and delay before fixing the real issues
- the biggest gains will come from component boundaries, query/mutation strategy, and IA cleanup

React migration should only be reconsidered if:

- the team strongly prefers React for future hiring velocity
- you want to standardize the whole frontend stack around React
- the refactor reveals a specific Solid ecosystem limitation that blocks delivery

Right now, that evidence is not present.

### Design target

Target a more editorial, ledger-like aesthetic instead of generic SaaS dark mode.

Principles:

- personal state first, household state second
- one focal task per screen
- big typographic hierarchy for money and due-state
- softer motion, fewer busy badges
- richer material feel: paper/ledger/editorial cues rather than green-glass dashboard cues
- admin tools feel like a separate control layer, not incidental clutter in member flows

## UX Rules For The Refactor

### Loading and mutation behavior

New rules:

- use skeletons only for initial page or section load
- do not blank or re-skeleton the page after local mutations
- preserve prior data while background refresh happens
- prefer optimistic updates for small deterministic changes
- use subtle pending affordances:
  - disabled button text changes
  - inline status chips
  - row-level pending styles
  - soft progress bars or shimmer overlays when needed
- use toasts for completion/failure, not blocking full-screen loaders

### Screen intent

- `Home` should answer: what do I owe, what is waiting on me, what should I do next
- `Activity` should answer: what happened, what was purchased, what was paid, what changed
- `Bills` should answer: what must be entered or resolved this cycle
- `Household` should answer: who is in the house, what are the rules, what are the destinations/settings

This is clearer than the current split between `Balances`, `Bills`, `Purchases`, and hidden `Settings`.

## Proposed New Information Architecture

### Top-level navigation

- `Today`
- `Activity`
- `Bills`
- `Household`

Mapping:

- `Today`: personal due state, quick pay, assigned utilities, unresolved purchase balance, upcoming reminders
- `Activity`: purchases, payments, settlement events, filters, history, details
- `Bills`: utility plan, rent cycle, bill entry, vendor payments, cycle-level admin tools
- `Household`: profile, members, pending approvals, categories, payment destinations, assistant settings

### Resident vs admin layering

- residents should see their action path first
- admin sections should appear only where they are relevant
- admin tools should live in explicit sections with clear labels, not be intermixed with resident content line by line

## Proposed Technical Refactor

### 1. Replace the dashboard mega-context with feature queries

Current issue:

- [apps/miniapp/src/contexts/dashboard-context.tsx](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx) holds fetch orchestration, derived view models, demo/testing state, and shared loading flags

Refactor:

- keep a small session/app-shell context
- move data into feature hooks built on TanStack Solid Query
- create separate query resources for:
  - dashboard summary
  - payment periods
  - purchases
  - admin settings
  - billing cycle
  - pending members
- move heavy derived selectors next to their feature modules instead of keeping them all in one provider

Result:

- route-level independence
- more precise invalidation
- simpler testing
- no global refresh hammer

### 2. Use query primitives idiomatically

Current issue:

- the app depends on `@tanstack/solid-query`, but only uses `fetchQuery()` and manual invalidation wrappers in [apps/miniapp/src/app/miniapp-queries.ts](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/app/miniapp-queries.ts)

Refactor:

- introduce `createQuery`/`createMutation` based hooks
- use `keepPreviousData` style behavior to preserve visible state during background refetch
- update cache directly from mutation responses where the API already returns refreshed data
- invalidate only the affected query slices

Result:

- initial load still gets skeletons
- subsequent writes keep the screen stable
- loaders become local and subtle rather than global and blocking

### 3. Create feature slices

Proposed feature directories:

- `src/features/session`
- `src/features/today`
- `src/features/activity`
- `src/features/bills`
- `src/features/household`
- `src/features/payments`
- `src/features/purchases`
- `src/features/admin`
- `src/features/testing`

Each slice should own:

- API adapters
- query hooks
- local selectors/view models
- components
- route containers

### 4. Split route monoliths into containers + sections

Refactor each large route into:

- route container
- presentational sections
- mutation dialogs/editors
- feature-local helpers

Target:

- no route file over ~250-350 lines
- no context file over ~200-250 lines
- no massive one-file interaction surfaces unless there is a strong reason

### 5. Replace the global stylesheet with layered styling

Current issue:

- [apps/miniapp/src/index.css](/Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/index.css) is too large for safe iteration

Refactor:

- keep core tokens in `theme.css`
- split styles by layer:
  - `styles/foundation.css`
  - `styles/layout.css`
  - `styles/components/*.css`
  - `styles/features/*.css`
- or colocate CSS modules if preferred

Result:

- safer edits
- more discoverable design system
- less accidental coupling between unrelated screens

## Mutation UX Plan

### Replace spinner-first UX

Current behavior:

- buttons frequently show spinner icons
- many saves end with a full data refresh
- route content may re-enter `loading()` branches

New behavior:

- preserve existing data on screen
- patch query cache immediately when the mutation result is deterministic
- use tiny pending states on the item being edited
- only show blocking UI for destructive or multi-step actions that truly require it

Examples:

- save utility amount:
  - keep the row visible
  - lock only that row
  - show subtle "Saved" confirmation
- approve pending member:
  - remove the row optimistically
  - restore on failure
- add payment:
  - append payment locally
  - update the affected member totals immediately
  - background revalidate afterward
- edit purchase:
  - update the purchase card in place
  - avoid collapsing the whole list into a generic loading branch

### Skeleton policy

- app boot: full skeleton
- route first entry: section skeletons
- tab switch with cold data: section skeletons
- mutation after data is visible: no skeleton reset

## Visual Redesign Plan

### Aesthetic direction

Move from:

- dark SaaS dashboard
- bright green status accent
- glass card repetition

Move to:

- editorial ledger / boutique finance notebook
- stronger type hierarchy and calmer accent usage
- warmer neutrals or ink-like dark tones
- clearer surfaces with deliberate contrast between summary, action, and archival content

### Visual system changes

- replace `Inter` with a more characterful display/body pairing
- reduce default badge density
- increase whitespace between conceptual sections
- make money typography more dramatic and readable
- make primary action areas feel singular, not equal-weight cards
- use motion for entry and confirmation, not for constant ornament

### Screen-specific redesign goals

- `Today`: one dominant balance card, one primary next action, one compact timeline
- `Activity`: strong filtering, better chronology, cleaner purchase/payment cards
- `Bills`: operational workspace feel, clearer assignment and resolution flows
- `Household`: settings hub with grouped cards and explicit admin zones

## Execution Plan

### Phase 1. Stabilize architecture without changing product behavior

- introduce feature folders
- convert manual query orchestration to query hooks
- remove global `loading` refresh behavior
- keep routes visually close to current UI
- add tests around query invalidation and mutation cache updates

### Phase 2. Restructure navigation and route boundaries

- rename/reorganize top-level routes
- move admin-heavy surfaces out of general summary screens
- break route files into sections and dialogs
- keep copy and domain behavior intact

### Phase 3. Redesign core surfaces

- rebuild shell, top bar, tabs, section headers, cards, lists, and forms
- introduce new typography, spacing, and visual hierarchy
- redesign `Today` first, then `Activity`, then `Bills`, then `Household`

### Phase 4. Upgrade mutation UX

- optimistic updates for frequent actions
- row-level pending states
- remove spinner-first buttons where not necessary
- preserve visible state during all background refetches

### Phase 5. Remove obsolete structures

- delete dead selectors, temporary compatibility helpers, and duplicated route logic
- remove hidden or confusing control surfaces unless they are intentionally productized
- revisit the hidden testing panel and move it behind explicit dev/demo gates

## Risks

- the current route files contain intertwined business display logic, so extraction will uncover hidden coupling
- optimistic UI requires careful cache patching for money-sensitive views
- admin/resident separation may reveal missing backend contract boundaries
- visual redesign without IA cleanup would only repaint the same complexity

## Acceptance Criteria

- initial load uses skeletons; post-mutation flows do not reset the screen to loading
- top-level navigation reflects user intent instead of implementation history
- resident flows are simpler and more obvious
- admin tools are easier to find and less intrusive
- route files and shared state layers are substantially smaller and easier to reason about
- the app has a distinctive visual identity instead of generic dark-dashboard styling

## Recommendation

Proceed with a SolidJS-based massive refactor.

Order of operations:

1. data/query architecture
2. route and feature decomposition
3. navigation and IA rewrite
4. visual redesign
5. optimistic mutation UX polish

Do not start with React migration. If the refactor is done well, Solid is sufficient for this product.
