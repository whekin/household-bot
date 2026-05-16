ALTER TABLE "payment_records" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_idempotency_unique" ON "payment_records" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "utility_vendor_payment_facts_idempotency_unique" ON "utility_vendor_payment_facts" USING btree ("idempotency_key");
