# Mini App Admin Billing Controls

## Summary

Allow household admins to manage billing-cycle configuration from the mini app: rent amount, reminder timing, utility timing, utility categories, and admin promotion.

## Goals

- Let admins control billing settings without bot commands or Terraform edits.
- Persist household-level billing preferences in the database.
- Support configurable utility categories per household.
- Let admins promote other household members to admin from the mini app.
- Provide a stable API contract for future reminder and finance UI.

## Non-goals

- Full accounting redesign.
- Per-member notification preferences.
- Utility OCR/import integrations.
- Member removal/deactivation in this slice.

## Scope

- In: household billing settings persistence, utility category management, admin promotion, mini app admin endpoints/UI.
- Out: historical category migration tools, reminder delivery redesign, presence/day-based utility UI.

## Interfaces and Contracts

- Mini app admin endpoints:
  - `POST /api/miniapp/admin/settings`
  - `POST /api/miniapp/admin/settings/update`
  - `POST /api/miniapp/admin/utility-categories/upsert`
  - `POST /api/miniapp/admin/members/promote`
- Admin-only mini app settings screen sections:
  - Rent
  - Utility categories
  - Reminder timing
  - Admins

## Domain Rules

- Only active household admins may update household billing settings.
- Billing timing is household-scoped, not user-scoped.
- Utility categories are household-scoped and deterministic in display order.
- Promotion can only target active household members of the same household.
- At least one admin must remain in the household.
- Money remains stored in minor units only.

## Data Model Changes

- Add `household_billing_settings` one-to-one table:
  - `household_id`
  - `rent_currency`
  - `rent_amount_minor` nullable until configured
  - `rent_due_day`
  - `rent_warning_day`
  - `utilities_due_day`
  - `utilities_reminder_day`
  - `timezone`
  - timestamps
- Add `household_utility_categories` table:
  - `household_id`
  - `slug`
  - `name`
  - `sort_order`
  - `is_active`
  - timestamps
- Seed default categories for new and existing households:
  - `internet`
  - `gas_water`
  - `cleaning`
  - `electricity`
- Add nullable `utility_category_id` to `utility_bills` in a later follow-up if needed for entry-level classification.

## Security and Privacy

- All endpoints require authenticated mini app sessions.
- All write endpoints require admin authorization from persisted membership.
- Promote-admin actions should be logged with actor and target IDs.

## Observability

- Structured logs for settings updates, category writes, and admin promotion.
- Include `householdId`, `actorMemberId`, `targetMemberId`, and changed fields.

## Edge Cases and Failure Modes

- Invalid day values outside 1..31.
- Reminder day later than due day.
- Duplicate category slug in one household.
- Promote-admin target missing or already admin.
- Missing settings record for an existing household should auto-bootstrap defaults.

## Test Plan

- Unit:
  - settings validation rules
  - category upsert ordering and duplicate handling
  - admin promotion authorization
- Integration:
  - DB adapter round-trips for settings and categories
- E2E:
  - admin changes settings in mini app and sees persisted values on reload

## Acceptance Criteria

- [ ] Admin can view and update household billing settings in the mini app.
- [ ] Admin can manage household utility categories in the mini app.
- [ ] Admin can promote an active member to admin in the mini app.
- [ ] Reminder timing values are persisted per household.
- [ ] Existing households auto-bootstrap sensible defaults.

## Rollout Plan

- Add schema and repository support first.
- Ship read-only settings payload next.
- Enable admin writes after UI is wired.
- Keep bot command paths working during rollout.
