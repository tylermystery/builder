ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "display_name" text;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "bio" text;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "image_urls" jsonb;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "store_name" text;--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "store_url" text;
