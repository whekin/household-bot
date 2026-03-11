CREATE TABLE "purchase_message_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_message_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"included" integer DEFAULT 1 NOT NULL,
	"share_amount_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_messages" ADD COLUMN "participant_split_mode" text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_message_participants" ADD CONSTRAINT "purchase_message_participants_purchase_message_id_purchase_messages_id_fk" FOREIGN KEY ("purchase_message_id") REFERENCES "public"."purchase_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_message_participants" ADD CONSTRAINT "purchase_message_participants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_message_participants_purchase_member_unique" ON "purchase_message_participants" USING btree ("purchase_message_id","member_id");--> statement-breakpoint
CREATE INDEX "purchase_message_participants_purchase_idx" ON "purchase_message_participants" USING btree ("purchase_message_id");--> statement-breakpoint
CREATE INDEX "purchase_message_participants_member_idx" ON "purchase_message_participants" USING btree ("member_id");