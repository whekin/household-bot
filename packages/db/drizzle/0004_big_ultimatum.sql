CREATE TABLE "anonymous_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"submitted_by_member_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"sanitized_text" text,
	"moderation_status" text NOT NULL,
	"moderation_reason" text,
	"telegram_chat_id" text NOT NULL,
	"telegram_message_id" text NOT NULL,
	"telegram_update_id" text NOT NULL,
	"posted_chat_id" text,
	"posted_thread_id" text,
	"posted_message_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "anonymous_messages" ADD CONSTRAINT "anonymous_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anonymous_messages" ADD CONSTRAINT "anonymous_messages_submitted_by_member_id_members_id_fk" FOREIGN KEY ("submitted_by_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anonymous_messages_household_tg_update_unique" ON "anonymous_messages" USING btree ("household_id","telegram_update_id");--> statement-breakpoint
CREATE INDEX "anonymous_messages_member_created_idx" ON "anonymous_messages" USING btree ("submitted_by_member_id","created_at");--> statement-breakpoint
CREATE INDEX "anonymous_messages_status_created_idx" ON "anonymous_messages" USING btree ("moderation_status","created_at");