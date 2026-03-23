CREATE TABLE "ad_hoc_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"creator_member_id" uuid NOT NULL,
	"assignee_member_id" uuid,
	"original_request_text" text NOT NULL,
	"notification_text" text NOT NULL,
	"timezone" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"time_precision" text NOT NULL,
	"delivery_mode" text NOT NULL,
	"dm_recipient_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"friendly_tag_assignee" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"source_telegram_chat_id" text,
	"source_telegram_thread_id" text,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
ALTER TABLE "purchase_messages" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "payer_member_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_hoc_notifications" ADD CONSTRAINT "ad_hoc_notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_hoc_notifications" ADD CONSTRAINT "ad_hoc_notifications_creator_member_id_members_id_fk" FOREIGN KEY ("creator_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_hoc_notifications" ADD CONSTRAINT "ad_hoc_notifications_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_hoc_notifications" ADD CONSTRAINT "ad_hoc_notifications_cancelled_by_member_id_members_id_fk" FOREIGN KEY ("cancelled_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD CONSTRAINT "payment_purchase_allocations_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD CONSTRAINT "payment_purchase_allocations_purchase_id_purchase_messages_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD CONSTRAINT "payment_purchase_allocations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_hoc_notifications_due_idx" ON "ad_hoc_notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "ad_hoc_notifications_household_status_idx" ON "ad_hoc_notifications" USING btree ("household_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "ad_hoc_notifications_creator_idx" ON "ad_hoc_notifications" USING btree ("creator_member_id");--> statement-breakpoint
CREATE INDEX "ad_hoc_notifications_assignee_idx" ON "ad_hoc_notifications" USING btree ("assignee_member_id");--> statement-breakpoint
CREATE INDEX "payment_purchase_allocations_payment_idx" ON "payment_purchase_allocations" USING btree ("payment_record_id");--> statement-breakpoint
CREATE INDEX "payment_purchase_allocations_purchase_member_idx" ON "payment_purchase_allocations" USING btree ("purchase_id","member_id");--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD CONSTRAINT "purchase_messages_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD CONSTRAINT "purchase_messages_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_messages_cycle_idx" ON "purchase_messages" USING btree ("cycle_id");