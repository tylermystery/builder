ALTER TABLE "public_items" ADD COLUMN "catalog_item_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "public_items_catalog_item_unique" ON "public_items" ("store_id","catalog_item_id");