CREATE TABLE "household_billing_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"rent_amount_minor" bigint,
	"rent_currency" text DEFAULT 'USD' NOT NULL,
	"rent_due_day" integer DEFAULT 20 NOT NULL,
	"rent_warning_day" integer DEFAULT 17 NOT NULL,
	"utilities_due_day" integer DEFAULT 4 NOT NULL,
	"utilities_reminder_day" integer DEFAULT 3 NOT NULL,
	"timezone" text DEFAULT 'Asia/Tbilisi' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_utility_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_billing_settings" ADD CONSTRAINT "household_billing_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_utility_categories" ADD CONSTRAINT "household_utility_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_billing_settings_household_unique" ON "household_billing_settings" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_utility_categories_household_slug_unique" ON "household_utility_categories" USING btree ("household_id","slug");--> statement-breakpoint
CREATE INDEX "household_utility_categories_household_sort_idx" ON "household_utility_categories" USING btree ("household_id","sort_order");