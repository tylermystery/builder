ALTER TABLE "item_variations" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "source" text DEFAULT 'edit' NOT NULL;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "based_on_variation_id" integer;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "item_variations" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "catalog_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "current_variation_id" integer;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "public_items" ADD COLUMN "review_note" text;--> statement-breakpoint
CREATE INDEX "public_items_store_catalog_status_idx" ON "public_items" ("store_id","catalog_status");--> statement-breakpoint
ALTER TABLE "item_variations" ADD CONSTRAINT "item_variations_based_on_variation_id_item_variations_id_fkey" FOREIGN KEY ("based_on_variation_id") REFERENCES "item_variations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "public_items" ADD CONSTRAINT "public_items_current_variation_id_item_variations_id_fkey" FOREIGN KEY ("current_variation_id") REFERENCES "item_variations"("id") ON DELETE SET NULL;