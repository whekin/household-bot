CREATE TABLE "member_repayments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_member_id" uuid,
	"to_member_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_on" date NOT NULL,
	"status" text NOT NULL,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_repayments_positive_amount" CHECK ("member_repayments"."amount_minor" > 0),
	CONSTRAINT "member_repayments_currency" CHECK ("member_repayments"."currency" in ('GEL', 'USD')),
	CONSTRAINT "member_repayments_shape" CHECK (("member_repayments"."kind" = 'request' and "member_repayments"."from_member_id" is null and "member_repayments"."request_id" is null and "member_repayments"."status" in ('open', 'closed')) or ("member_repayments"."kind" = 'transfer' and "member_repayments"."from_member_id" is not null and "member_repayments"."from_member_id" <> "member_repayments"."to_member_id" and "member_repayments"."status" in ('pending', 'confirmed', 'cancelled')))
);
--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ALTER COLUMN "purchase_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "member_repayments" ADD CONSTRAINT "member_repayments_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_repayments" ADD CONSTRAINT "member_repayments_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_repayments" ADD CONSTRAINT "member_repayments_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_repayments_household_idx" ON "member_repayments" USING btree ("household_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD CONSTRAINT "payment_purchase_allocations_transfer_id_member_repayments_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."member_repayments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_purchase_allocations" ADD CONSTRAINT "payment_allocations_one_source" CHECK (num_nonnulls("payment_purchase_allocations"."purchase_id", "payment_purchase_allocations"."transfer_id") = 1);