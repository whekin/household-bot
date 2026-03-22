ALTER TABLE "purchase_messages"
ADD COLUMN "payer_member_id" uuid REFERENCES "members"("id") ON DELETE SET NULL;

UPDATE "purchase_messages"
SET "payer_member_id" = "sender_member_id"
WHERE "payer_member_id" IS NULL
  AND "sender_member_id" IS NOT NULL;
