# Plan - UI Tweaks and Reactive Updates

This plan outlines the changes needed to ensure data reactivity after updates, improve chart visibility with better colors, and enhance the "Latest activity" section with a "show more" functionality.

## 1. Reactive Data Updates

### Analysis

Currently, when a purchase or payment is added in [ledger.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/ledger.tsx), `refreshHouseholdData(true, true)` is called. This function invalidates the TanStack Query cache in [session-context.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/session-context.tsx), but [DashboardProvider](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx) stores data in local signals (`setDashboard`) and does not automatically refetch when the cache is invalidated.

### Proposed Changes

- **session-context.tsx**:
  - Add a way to register "data listeners" or simply a list of refresh callbacks.
  - Update `refreshHouseholdData` to execute these callbacks.
- **dashboard-context.tsx**:
  - In `DashboardProvider`, register `loadDashboardData` as a listener in the session context on mount.
- **App.tsx**:
  - Ensure `DashboardProvider` is correctly integrated with the session's refresh mechanism.

## 2. Chart Colors Improvement

### Analysis

Current chart colors in [dashboard-context.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/contexts/dashboard-context.tsx) and [theme.css](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/theme.css) are somewhat similar, making them hard to distinguish.

### Proposed Changes

- **dashboard-context.tsx**:
  - Update `chartPalette` with more distinct, high-contrast colors.
  - Proposed palette: `#3ecf8e` (Emerald), `#3b82f6` (Blue), `#ef4444` (Red), `#f59e0b` (Amber), `#8b5cf6` (Violet), `#ec4899` (Pink).
- **theme.css**:
  - Update `--chart-1` through `--chart-6` variables to match the new palette for consistency across the app.

## 3. "Show More" for Latest Activity

### Analysis

The "Latest activity" section in [home.tsx](file:///Users/whekin/Projects/kojori-tg-bot/apps/miniapp/src/routes/home.tsx) currently only shows the first 5 entries of the ledger.

### Proposed Changes

- **home.tsx**:
  - Add a local signal `showAllActivity` (default `false`).
  - Update the `For` loop to show either `slice(0, 5)` or the full `ledger` based on the signal.
  - Add a "Show more" button that appears if `ledger.length > 5`.
  - Style the button to match the app's UI.
- **i18n.ts**:
  - Add translations for "Show more" and "Show less" (or "Collapse").

## Verification Plan

### Automated Tests

- Since this is mostly UI/UX, manual verification in the browser is preferred.
- Check if `invalidateQueries` is called after adding a purchase (can be checked via network tab).

### Manual Verification

1.  **Reactivity**: Add a purchase and verify that the dashboard balances and "Latest activity" update immediately without manual page refresh.
2.  **Chart Colors**: Navigate to the balances page and verify that chart slices are easily distinguishable.
3.  **Show More**: On the home page, ensure "Show more" appears when there are > 5 activities and correctly expands the list.
