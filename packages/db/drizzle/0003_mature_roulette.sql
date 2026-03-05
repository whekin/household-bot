ALTER TABLE "purchase_messages" ADD COLUMN "parsed_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "parsed_currency" text;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "parsed_item_description" text;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "parser_mode" text;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "parser_confidence" integer;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "needs_review" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "parser_error" text;