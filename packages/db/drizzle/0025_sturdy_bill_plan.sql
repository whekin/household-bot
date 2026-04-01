CREATE TABLE "utility_billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"due_date" date NOT NULL,
	"currency" text NOT NULL,
	"max_categories_per_member_applied" integer NOT NULL,
	"updated_from_plan_id" uuid,
	"reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utility_vendor_payment_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"utility_bill_id" uuid,
	"bill_name" text NOT NULL,
	"payer_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"planned_for_member_id" uuid,
	"plan_version" integer,
	"matched_plan" integer DEFAULT 0 NOT NULL,
	"recorded_by_member_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "utility_reimbursement_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"planned_from_member_id" uuid,
	"planned_to_member_id" uuid,
	"plan_version" integer,
	"matched_plan" integer DEFAULT 0 NOT NULL,
	"recorded_by_member_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "utility_billing_plans" ADD CONSTRAINT "utility_billing_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_billing_plans" ADD CONSTRAINT "utility_billing_plans_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_utility_bill_id_utility_bills_id_fk" FOREIGN KEY ("utility_bill_id") REFERENCES "public"."utility_bills"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_payer_member_id_members_id_fk" FOREIGN KEY ("payer_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_planned_for_member_id_members_id_fk" FOREIGN KEY ("planned_for_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_recorded_by_member_id_members_id_fk" FOREIGN KEY ("recorded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_planned_from_member_id_members_id_fk" FOREIGN KEY ("planned_from_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_planned_to_member_id_members_id_fk" FOREIGN KEY ("planned_to_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "utility_reimbursement_facts" ADD CONSTRAINT "utility_reimbursement_facts_recorded_by_member_id_members_id_fk" FOREIGN KEY ("recorded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "utility_billing_plans_cycle_version_unique" ON "utility_billing_plans" USING btree ("cycle_id","version");
--> statement-breakpoint
CREATE INDEX "utility_billing_plans_cycle_status_idx" ON "utility_billing_plans" USING btree ("cycle_id","status");
--> statement-breakpoint
CREATE INDEX "utility_billing_plans_household_created_idx" ON "utility_billing_plans" USING btree ("household_id","created_at");
--> statement-breakpoint
CREATE INDEX "utility_vendor_payment_facts_cycle_idx" ON "utility_vendor_payment_facts" USING btree ("cycle_id");
--> statement-breakpoint
CREATE INDEX "utility_vendor_payment_facts_bill_idx" ON "utility_vendor_payment_facts" USING btree ("utility_bill_id");
--> statement-breakpoint
CREATE INDEX "utility_vendor_payment_facts_payer_idx" ON "utility_vendor_payment_facts" USING btree ("payer_member_id");
--> statement-breakpoint
CREATE INDEX "utility_reimbursement_facts_cycle_idx" ON "utility_reimbursement_facts" USING btree ("cycle_id");
--> statement-breakpoint
CREATE INDEX "utility_reimbursement_facts_from_idx" ON "utility_reimbursement_facts" USING btree ("from_member_id");
--> statement-breakpoint
CREATE INDEX "utility_reimbursement_facts_to_idx" ON "utility_reimbursement_facts" USING btree ("to_member_id");
