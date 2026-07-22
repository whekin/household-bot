# Member purchase entry

## Summary

Allow every active household member to add purchases from the mini app instead of limiting the
purchase composer to administrators.

## Target behavior

- The Home screen shows the quick purchase composer to active household members.
- The Home purchase card exposes its “Add purchase” action to active household members.
- The Activity add-entry chooser includes purchase creation for active household members.
- The add-purchase API accepts an authenticated active household member.
- Existing administrator-only editing, deletion, payment, rent, and household controls are
  unchanged.
- Inactive and unauthorized members remain unable to create purchases.

## Data model

No persistence or migration changes.

## Verification

- Handler coverage creates a purchase as an active non-admin member and verifies the submitted
  payer and split.
- Existing inactive-member coverage remains passing.
- Mini-app typecheck/build and full repository quality gates pass.
