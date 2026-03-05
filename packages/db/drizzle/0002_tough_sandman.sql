CREATE TABLE "purchase_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"sender_member_id" uuid,
	"sender_telegram_user_id" text NOT NULL,
	"sender_display_name" text,
	"raw_text" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_message_id" text NOT NULL,
	"telegram_thread_id" text NOT NULL,
	"telegram_update_id" text NOT NULL,
	"message_sent_at" timestamp with time zone,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD CONSTRAINT "purchase_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD CONSTRAINT "purchase_messages_sender_member_id_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_messages_household_thread_idx" ON "purchase_messages" USING btree ("household_id","telegram_thread_id");--> statement-breakpoint
CREATE INDEX "purchase_messages_sender_idx" ON "purchase_messages" USING btree ("sender_telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_messages_household_tg_message_unique" ON "purchase_messages" USING btree ("household_id","telegram_chat_id","telegram_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_messages_household_tg_update_unique" ON "purchase_messages" USING btree ("household_id","telegram_update_id");