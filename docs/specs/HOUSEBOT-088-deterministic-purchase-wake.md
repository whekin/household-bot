# Deterministic purchase-topic wake

## Summary

Recognize concise completed-purchase reports in the purchase topic reliably, including Telegram
photo captions and feminine Russian wording such as “Крючки 3 лари, купила”.

## Target behavior

- Text messages and photo captions use the same purchase-topic wake behavior.
- A message wakes the purchase flow deterministically when it contains both an explicit amount
  with currency and a completed-purchase verb.
- Russian masculine, feminine, and plural completed-purchase forms are equivalent.
- Negated, hypothetical, and interrogative wording does not use the deterministic shortcut.
- Less structured purchase messages continue through the existing classifier fallback.
- The deterministic shortcut applies only in the purchase topic.

## Data model

No persistence or migration changes.

## Verification

- Unit tests cover the reported multiline caption exactly.
- Unit tests reject negated, hypothetical, and question forms.
- Wake-gate tests verify that the reported caption wakes without relying on classifier output.
- Bot typecheck and full repository quality gates pass.
