DROP INDEX "telegram_pending_actions_chat_user_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_pending_actions_chat_user_action_unique" ON "telegram_pending_actions" USING btree ("telegram_chat_id","telegram_user_id","action");
