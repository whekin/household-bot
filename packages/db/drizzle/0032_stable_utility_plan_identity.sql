ALTER TABLE "utility_vendor_payment_facts" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "utility_vendor_payment_facts" ADD CONSTRAINT "utility_vendor_payment_facts_plan_id_utility_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."utility_billing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "utility_vendor_payment_facts" AS fact
SET "plan_id" = plan."id"
FROM "utility_billing_plans" AS plan
WHERE fact."cycle_id" = plan."cycle_id"
  AND fact."plan_version" = plan."version"
  AND fact."matched_plan" = 1;--> statement-breakpoint
CREATE INDEX "utility_vendor_payment_facts_plan_idx" ON "utility_vendor_payment_facts" USING btree ("plan_id");--> statement-breakpoint
WITH ranked_current_plans AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "cycle_id"
      ORDER BY "version" DESC, "created_at" DESC
    ) AS current_rank
  FROM "utility_billing_plans"
  WHERE "status" in ('active', 'settled')
)
UPDATE "utility_billing_plans"
SET "status" = 'superseded'
FROM ranked_current_plans
WHERE "utility_billing_plans"."id" = ranked_current_plans."id"
  AND ranked_current_plans.current_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "utility_billing_plans_cycle_current_unique" ON "utility_billing_plans" USING btree ("cycle_id") WHERE status in ('active', 'settled');
