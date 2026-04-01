ALTER TABLE "household_utility_categories"
ADD COLUMN "provider_name" text;
--> statement-breakpoint
ALTER TABLE "household_utility_categories"
ADD COLUMN "customer_number" text;
--> statement-breakpoint
ALTER TABLE "household_utility_categories"
ADD COLUMN "payment_link" text;
--> statement-breakpoint
ALTER TABLE "household_utility_categories"
ADD COLUMN "note" text;
--> statement-breakpoint
ALTER TABLE "member_absence_policies"
ADD COLUMN "starts_on" date;
--> statement-breakpoint
ALTER TABLE "member_absence_policies"
ADD COLUMN "ends_on" date;
--> statement-breakpoint
UPDATE "member_absence_policies"
SET "starts_on" = ("effective_from_period" || '-01')::date;
--> statement-breakpoint
ALTER TABLE "member_absence_policies"
ALTER COLUMN "starts_on" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "member_absence_policies_household_member_period_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "member_absence_policies_household_member_start_unique"
ON "member_absence_policies" USING btree ("household_id","member_id","starts_on");
--> statement-breakpoint
CREATE INDEX "member_absence_policies_household_range_idx"
ON "member_absence_policies" USING btree ("household_id","starts_on","ends_on");
--> statement-breakpoint
ALTER TABLE "member_absence_policies"
DROP COLUMN "effective_from_period";
