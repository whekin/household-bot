CREATE TABLE "billing_cycle_exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"source_currency" text NOT NULL,
	"target_currency" text NOT NULL,
	"rate_micros" bigint NOT NULL,
	"effective_date" date NOT NULL,
	"source" text DEFAULT 'nbg' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_billing_settings" ADD COLUMN "settlement_currency" text DEFAULT 'GEL' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_cycle_exchange_rates" ADD CONSTRAINT "billing_cycle_exchange_rates_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_cycle_exchange_rates_cycle_pair_unique" ON "billing_cycle_exchange_rates" USING btree ("cycle_id","source_currency","target_currency");--> statement-breakpoint
CREATE INDEX "billing_cycle_exchange_rates_cycle_idx" ON "billing_cycle_exchange_rates" USING btree ("cycle_id");