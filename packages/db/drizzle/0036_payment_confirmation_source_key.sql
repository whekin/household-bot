ALTER TABLE "payment_confirmations" ADD COLUMN "source_key" text;
--> statement-breakpoint
UPDATE "payment_confirmations" SET "source_key" = "telegram_message_id" WHERE "source_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "payment_confirmations" ALTER COLUMN "source_key" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "payment_confirmations_household_tg_message_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "payment_confirmations_household_tg_update_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_confirmations_household_source_key_unique" ON "payment_confirmations" USING btree ("household_id","telegram_chat_id","source_key");
--> statement-breakpoint
CREATE INDEX "payment_confirmations_household_tg_update_idx" ON "payment_confirmations" USING btree ("household_id","telegram_update_id");
