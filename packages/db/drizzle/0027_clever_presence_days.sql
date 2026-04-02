CREATE TABLE "member_presence_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE cascade,
  "member_id" uuid NOT NULL REFERENCES "members"("id") ON DELETE cascade,
  "period" text NOT NULL,
  "days_present" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_presence_days_household_member_period_unique"
ON "member_presence_days" USING btree ("household_id","member_id","period");
--> statement-breakpoint
CREATE INDEX "member_presence_days_household_period_idx"
ON "member_presence_days" USING btree ("household_id","period");
--> statement-breakpoint
CREATE INDEX "member_presence_days_household_member_idx"
ON "member_presence_days" USING btree ("household_id","member_id");
