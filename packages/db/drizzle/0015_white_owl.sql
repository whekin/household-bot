CREATE TABLE "member_absence_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"effective_from_period" text NOT NULL,
	"policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_absence_policies" ADD CONSTRAINT "member_absence_policies_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_absence_policies" ADD CONSTRAINT "member_absence_policies_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_absence_policies_household_member_period_unique" ON "member_absence_policies" USING btree ("household_id","member_id","effective_from_period");--> statement-breakpoint
CREATE INDEX "member_absence_policies_household_member_idx" ON "member_absence_policies" USING btree ("household_id","member_id");