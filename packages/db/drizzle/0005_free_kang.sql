CREATE TABLE "household_telegram_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_chat_type" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_topic_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"role" text NOT NULL,
	"telegram_thread_id" text NOT NULL,
	"topic_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_telegram_chats" ADD CONSTRAINT "household_telegram_chats_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_topic_bindings" ADD CONSTRAINT "household_topic_bindings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_telegram_chats_household_unique" ON "household_telegram_chats" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_telegram_chats_chat_unique" ON "household_telegram_chats" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_topic_bindings_household_role_unique" ON "household_topic_bindings" USING btree ("household_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "household_topic_bindings_household_thread_unique" ON "household_topic_bindings" USING btree ("household_id","telegram_thread_id");--> statement-breakpoint
CREATE INDEX "household_topic_bindings_household_role_idx" ON "household_topic_bindings" USING btree ("household_id","role");