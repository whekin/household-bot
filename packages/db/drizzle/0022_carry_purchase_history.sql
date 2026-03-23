ALTER TABLE "purchase_messages"
ADD COLUMN "cycle_id" uuid REFERENCES "billing_cycles"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "purchase_messages_cycle_idx" ON "purchase_messages" USING btree ("cycle_id");
--> statement-breakpoint
CREATE TABLE "payment_purchase_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_record_id" uuid NOT NULL,
  "purchase_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "amount_minor" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations"
ADD CONSTRAINT "payment_purchase_allocations_payment_record_id_payment_records_id_fk"
FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations"
ADD CONSTRAINT "payment_purchase_allocations_purchase_id_purchase_messages_id_fk"
FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_messages"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations"
ADD CONSTRAINT "payment_purchase_allocations_member_id_members_id_fk"
FOREIGN KEY ("member_id") REFERENCES "public"."members"("id")
ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_purchase_allocations_payment_idx"
ON "payment_purchase_allocations" USING btree ("payment_record_id");
--> statement-breakpoint
CREATE INDEX "payment_purchase_allocations_purchase_member_idx"
ON "payment_purchase_allocations" USING btree ("purchase_id","member_id");
