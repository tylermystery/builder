ALTER TABLE "public_items" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "notified_stage" text;