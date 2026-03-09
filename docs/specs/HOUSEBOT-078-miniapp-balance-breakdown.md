# HOUSEBOT-078 Mini App Balance Breakdown

## Goal

Make the mini app read like a real household statement instead of a generic dashboard shell.

## Scope

- highlight the current member's own balance first
- show base due (`rent + utilities`) separately from the shared-purchase adjustment and final due
- keep full-household balance visibility below the personal summary
- split ledger presentation into shared purchases and utility bills
- avoid float math in UI money calculations

## Notes

- no settlement logic changes in this slice
- use existing dashboard API data where possible
- prefer exact bigint formatting helpers over `number` math in the client
