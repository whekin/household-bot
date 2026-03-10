CREATE TABLE "payment_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid,
	"member_id" uuid,
	"sender_telegram_user_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"detected_kind" text,
	"explicit_amount_minor" bigint,
	"explicit_currency" text,
	"resolved_amount_minor" bigint,
	"resolved_currency" text,
	"status" text NOT NULL,
	"review_reason" text,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_message_id" text NOT NULL,
	"telegram_thread_id" text NOT NULL,
	"telegram_update_id" text NOT NULL,
	"message_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"confirmation_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_confirmations" ADD CONSTRAINT "payment_confirmations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_confirmations" ADD CONSTRAINT "payment_confirmations_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_confirmations" ADD CONSTRAINT "payment_confirmations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_confirmation_id_payment_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."payment_confirmations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_confirmations_household_tg_message_unique" ON "payment_confirmations" USING btree ("household_id","telegram_chat_id","telegram_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_confirmations_household_tg_update_unique" ON "payment_confirmations" USING btree ("household_id","telegram_update_id");--> statement-breakpoint
CREATE INDEX "payment_confirmations_household_status_idx" ON "payment_confirmations" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "payment_confirmations_member_created_idx" ON "payment_confirmations" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_records_cycle_member_idx" ON "payment_records" USING btree ("cycle_id","member_id");--> statement-breakpoint
CREATE INDEX "payment_records_cycle_kind_idx" ON "payment_records" USING btree ("cycle_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_records_confirmation_unique" ON "payment_records" USING btree ("confirmation_id");