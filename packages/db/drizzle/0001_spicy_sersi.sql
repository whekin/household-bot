CREATE TABLE "billing_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presence_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"utility_days" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_bot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_message_key" text NOT NULL,
	"payload_hash" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid,
	"payer_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text,
	"parser_mode" text NOT NULL,
	"parser_confidence" integer NOT NULL,
	"telegram_chat_id" text,
	"telegram_message_id" text,
	"telegram_thread_id" text,
	"message_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"effective_from_period" text NOT NULL,
	"effective_to_period" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"rent_share_minor" bigint NOT NULL,
	"utility_share_minor" bigint NOT NULL,
	"purchase_offset_minor" bigint NOT NULL,
	"net_due_minor" bigint NOT NULL,
	"explanations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"total_due_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utility_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"bill_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"due_date" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_overrides" ADD CONSTRAINT "presence_overrides_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence_overrides" ADD CONSTRAINT "presence_overrides_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_bot_messages" ADD CONSTRAINT "processed_bot_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_rules" ADD CONSTRAINT "rent_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utility_bills" ADD CONSTRAINT "utility_bills_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_cycles_household_period_unique" ON "billing_cycles" USING btree ("household_id","period");--> statement-breakpoint
CREATE INDEX "billing_cycles_household_period_idx" ON "billing_cycles" USING btree ("household_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "presence_overrides_cycle_member_unique" ON "presence_overrides" USING btree ("cycle_id","member_id");--> statement-breakpoint
CREATE INDEX "presence_overrides_cycle_idx" ON "presence_overrides" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_bot_messages_source_message_unique" ON "processed_bot_messages" USING btree ("household_id","source","source_message_key");--> statement-breakpoint
CREATE INDEX "purchase_entries_household_cycle_idx" ON "purchase_entries" USING btree ("household_id","cycle_id");--> statement-breakpoint
CREATE INDEX "purchase_entries_payer_idx" ON "purchase_entries" USING btree ("payer_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_entries_household_tg_message_unique" ON "purchase_entries" USING btree ("household_id","telegram_chat_id","telegram_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_rules_household_from_period_unique" ON "rent_rules" USING btree ("household_id","effective_from_period");--> statement-breakpoint
CREATE INDEX "rent_rules_household_from_period_idx" ON "rent_rules" USING btree ("household_id","effective_from_period");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_lines_settlement_member_unique" ON "settlement_lines" USING btree ("settlement_id","member_id");--> statement-breakpoint
CREATE INDEX "settlement_lines_settlement_idx" ON "settlement_lines" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_cycle_unique" ON "settlements" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "settlements_household_computed_idx" ON "settlements" USING btree ("household_id","computed_at");--> statement-breakpoint
CREATE INDEX "utility_bills_cycle_idx" ON "utility_bills" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "utility_bills_household_cycle_idx" ON "utility_bills" USING btree ("household_id","cycle_id");