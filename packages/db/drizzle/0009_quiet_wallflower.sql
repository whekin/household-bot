ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "default_locale" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "preferred_locale" text;--> statement-breakpoint
