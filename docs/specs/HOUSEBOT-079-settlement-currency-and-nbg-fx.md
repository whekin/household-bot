# HOUSEBOT-079 Settlement Currency And NBG FX

## Goal

Make household balances settle in a configurable household currency while preserving original entry currencies.

## Scope

- add a household `settlementCurrency` setting, defaulting to `GEL`
- open new billing cycles in the settlement currency by default
- keep rent rules in their original source currency
- convert rent, utility bills, and purchase entries into the billing cycle currency for settlement
- lock cycle exchange rates in the database once the configured reminder day has passed
- use NBG as the FX source for GEL conversions
- show both original and converted amounts in the mini app when they differ
- default utility entry currency and bare purchase parsing currency to the household settlement currency

## Notes

- this slice does not add payment confirmation tracking yet
- current FX behavior uses the configured reminder day as the target lock date
- before the reminder day passes, the app may preview the latest available NBG rate without persisting it
- after the reminder day passes, the rate is persisted per cycle and currency pair for deterministic future statements
