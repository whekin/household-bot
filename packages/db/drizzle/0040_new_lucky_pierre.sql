CREATE TABLE "telegram_payment_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"surface" text NOT NULL,
	"locale" text NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_thread_id" text,
	"telegram_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_payment_cards" ADD CONSTRAINT "telegram_payment_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_payment_cards_message_unique" ON "telegram_payment_cards" USING btree ("telegram_chat_id","telegram_message_id");--> statement-breakpoint
CREATE INDEX "telegram_payment_cards_household_period_idx" ON "telegram_payment_cards" USING btree ("household_id","kind","period");