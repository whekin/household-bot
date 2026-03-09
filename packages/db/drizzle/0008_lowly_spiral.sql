ALTER TABLE "households" ADD COLUMN "default_locale" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "preferred_locale" text;--> statement-breakpoint
