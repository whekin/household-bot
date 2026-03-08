# HOUSEBOT-040: Mini App Shell with Telegram Auth Gate

## Summary

Build the first usable SolidJS mini app shell with a real Telegram initData verification flow and a household membership gate.

## Goals

- Verify Telegram mini app initData on the backend.
- Block non-members from entering the mini app shell.
- Provide a bilingual RU/EN shell with navigation ready for later dashboard features.
- Keep local development usable with a demo fallback.

## Non-goals

- Full balances and ledger data rendering.
- House wiki content population.
- Production analytics or full design-system work.

## Scope

- In: backend auth endpoint, membership lookup, CORS handling, shell layout, locale toggle, runtime bot API URL injection.
- Out: real balances API, ledger API, notification center.

## Interfaces and Contracts

- Backend endpoint: `POST /api/miniapp/session`
- Request body:
  - `initData: string`
- Success response:
  - `authorized: true`
  - `member`
  - `telegramUser`
- Membership failure:
  - `authorized: false`
  - `reason: "not_member"`

## Security and Privacy

- Telegram initData is verified with the bot token before membership lookup.
- Mini app access depends on an actual household membership match.
- CORS can be limited via `MINI_APP_ALLOWED_ORIGINS`; local development may use permissive origin reflection, but production must use an explicit allow-list.

## UX Notes

- RU/EN switch is always visible.
- Demo shell appears automatically in local development when Telegram data is unavailable.
- Layout is mobile-first and Telegram webview friendly.

## Test Plan

- Unit tests for Telegram initData verification.
- Unit tests for mini app auth handler membership outcomes.
- Full repo typecheck, tests, and build.

## Acceptance Criteria

- [ ] Unauthorized users are blocked.
- [ ] RU/EN language switch is present.
- [ ] Base shell and navigation are ready for later finance views.
