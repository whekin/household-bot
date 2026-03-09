CREATE TABLE "household_join_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by_telegram_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_pending_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"telegram_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"language_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_join_tokens" ADD CONSTRAINT "household_join_tokens_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_pending_members" ADD CONSTRAINT "household_pending_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_join_tokens_household_unique" ON "household_join_tokens" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_join_tokens_token_unique" ON "household_join_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "household_pending_members_household_user_unique" ON "household_pending_members" USING btree ("household_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX "household_pending_members_telegram_user_idx" ON "household_pending_members" USING btree ("telegram_user_id");