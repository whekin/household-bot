CREATE TABLE "telegram_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_pending_actions_chat_user_unique" ON "telegram_pending_actions" USING btree ("telegram_chat_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX "telegram_pending_actions_user_action_idx" ON "telegram_pending_actions" USING btree ("telegram_user_id","action");
