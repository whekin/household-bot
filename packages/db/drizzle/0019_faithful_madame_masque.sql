CREATE TABLE "topic_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_thread_id" text,
	"telegram_message_id" text,
	"telegram_update_id" text,
	"sender_telegram_user_id" text,
	"sender_display_name" text,
	"is_bot" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"message_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_messages" ADD CONSTRAINT "topic_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_messages_household_thread_sent_idx" ON "topic_messages" USING btree ("household_id","telegram_chat_id","telegram_thread_id","message_sent_at");--> statement-breakpoint
CREATE INDEX "topic_messages_household_chat_sent_idx" ON "topic_messages" USING btree ("household_id","telegram_chat_id","message_sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_messages_household_tg_message_unique" ON "topic_messages" USING btree ("household_id","telegram_chat_id","telegram_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_messages_household_tg_update_unique" ON "topic_messages" USING btree ("household_id","telegram_update_id");