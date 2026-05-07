CREATE TABLE "member_balance_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "source_cycle_id" uuid NOT NULL,
  "source_cycle_period" text NOT NULL,
  "plan_id" uuid,
  "entry_type" text NOT NULL,
  "policy_target" text DEFAULT 'balance_policy' NOT NULL,
  "reason" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_balance_ledger_entries" ADD CONSTRAINT "member_balance_ledger_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_balance_ledger_entries" ADD CONSTRAINT "member_balance_ledger_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_balance_ledger_entries" ADD CONSTRAINT "member_balance_ledger_entries_source_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("source_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_balance_ledger_entries" ADD CONSTRAINT "member_balance_ledger_entries_plan_id_utility_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."utility_billing_plans"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_balance_ledger_household_member_idx" ON "member_balance_ledger_entries" USING btree ("household_id","member_id");
--> statement-breakpoint
CREATE INDEX "member_balance_ledger_source_cycle_idx" ON "member_balance_ledger_entries" USING btree ("source_cycle_id");
--> statement-breakpoint
CREATE INDEX "member_balance_ledger_plan_idx" ON "member_balance_ledger_entries" USING btree ("plan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "member_balance_ledger_idempotency_unique" ON "member_balance_ledger_entries" USING btree ("idempotency_key");
