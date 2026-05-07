CREATE TABLE "purchase_topic_messages" (
  "purchase_message_id" uuid PRIMARY KEY NOT NULL,
  "household_id" uuid NOT NULL,
  "telegram_chat_id" text NOT NULL,
  "telegram_thread_id" text NOT NULL,
  "telegram_message_id" text NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_topic_messages" ADD CONSTRAINT "purchase_topic_messages_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "purchase_topic_messages_household_idx" ON "purchase_topic_messages" USING btree ("household_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_topic_messages_telegram_message_unique" ON "purchase_topic_messages" USING btree ("telegram_chat_id","telegram_thread_id","telegram_message_id");
