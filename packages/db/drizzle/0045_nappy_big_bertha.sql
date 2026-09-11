CREATE TABLE "household_routines" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_routines" ADD CONSTRAINT "household_routines_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_routines_household_idx" ON "household_routines" USING btree ("household_id");