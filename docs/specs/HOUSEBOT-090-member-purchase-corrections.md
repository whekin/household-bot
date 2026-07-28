# Member purchase corrections

## Summary

Allow active household members to correct purchases they created without granting them
administrator access to other finance records.

## Target behavior

- An active member can edit or delete a purchase they created.
- Member correction is limited to purchases in the current billing cycle.
- A member cannot edit or delete a purchase after any payment allocation has been recorded against
  it.
- A member cannot change the payer of a purchase during correction.
- A non-admin member can create a purchase only for themselves as payer.
- Administrators retain the existing ability to create purchases for another payer and to
  edit/delete household purchases.
- Purchase author and payer remain separate facts. Changing the payer must not change the author.
- Successful edits and deletions continue to emit audit events and synchronize the Telegram
  purchase notice.

## Ownership and persistence

- The existing `purchase_messages.sender_member_id` column is the purchase author.
- The finance port exposes this value as `createdByMemberId`.
- No migration is required.
- Existing mini-app purchases retain their currently stored sender as the best available author.

## Mini app

- Editable rows include current-cycle, unallocated purchases created by the current member.
- The payer control is fixed for residents and remains selectable for administrators.
- The server remains the authorization boundary; client visibility is only an affordance.

## Out of scope

- Editing purchases from closed or historical cycles.
- Reversing settled purchases through compensating ledger entries.
- A time-based correction window.
- Member editing of utility bills, payments, rent, or another member's purchase.

## Verification

- Handler tests cover owner edit/delete, non-owner rejection, payer-change rejection, and locked
  allocated purchases.
- Repository/service tests preserve author separately from payer.
- Mini-app tests cover the editable-row policy.
- Full repository quality gates pass.
