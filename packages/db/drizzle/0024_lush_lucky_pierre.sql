CREATE TABLE "scheduled_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"provider" text NOT NULL,
	"provider_dispatch_id" text,
	"ad_hoc_notification_id" uuid,
	"period" text,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_dispatches" ADD CONSTRAINT "scheduled_dispatches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_dispatches" ADD CONSTRAINT "scheduled_dispatches_ad_hoc_notification_id_ad_hoc_notifications_id_fk" FOREIGN KEY ("ad_hoc_notification_id") REFERENCES "public"."ad_hoc_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_dispatches_due_idx" ON "scheduled_dispatches" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "scheduled_dispatches_household_kind_idx" ON "scheduled_dispatches" USING btree ("household_id","kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_dispatches_ad_hoc_notification_unique" ON "scheduled_dispatches" USING btree ("ad_hoc_notification_id");