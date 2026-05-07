CREATE TABLE "household_notification_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "period_events" integer DEFAULT 1 NOT NULL,
  "plan_events" integer DEFAULT 1 NOT NULL,
  "purchase_events" integer DEFAULT 1 NOT NULL,
  "payment_events" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "actor_member_id" uuid,
  "actor_display_name" text NOT NULL,
  "event_type" text NOT NULL,
  "category" text NOT NULL,
  "summary_text" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "delivery_status" text DEFAULT 'pending' NOT NULL,
  "delivered_telegram_chat_id" text,
  "delivered_telegram_thread_id" text,
  "delivered_telegram_message_id" text,
  "delivery_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_notification_settings" ADD CONSTRAINT "household_notification_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_audit_events" ADD CONSTRAINT "household_audit_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_audit_events" ADD CONSTRAINT "household_audit_events_actor_member_id_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "household_notification_settings_household_unique" ON "household_notification_settings" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX "household_audit_events_household_created_idx" ON "household_audit_events" USING btree ("household_id","created_at");
--> statement-breakpoint
CREATE INDEX "household_audit_events_household_category_idx" ON "household_audit_events" USING btree ("household_id","category","created_at");
--> statement-breakpoint
CREATE INDEX "household_audit_events_actor_idx" ON "household_audit_events" USING btree ("actor_member_id");
