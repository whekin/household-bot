ALTER TABLE "payment_records" ADD COLUMN "funding_phase" bigint;--> statement-breakpoint
WITH phases AS (
  SELECT id, row_number() OVER (PARTITION BY cycle_id ORDER BY created_at, id) AS phase
  FROM payment_records
)
UPDATE payment_records SET funding_phase = phases.phase FROM phases WHERE payment_records.id = phases.id;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "purchase_funding_context" jsonb;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "purchase_reconciliation_pending" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_records_reconciliation_idx" ON "payment_records" USING btree ("household_id","cycle_id","purchase_reconciliation_pending");
