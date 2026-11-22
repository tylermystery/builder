CREATE TABLE "store_members" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"status" text DEFAULT 'contributor' NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	"approved_at" timestamp,
	"approved_by" text
);
--> statement-breakpoint
ALTER TABLE "public_items" ALTER COLUMN "catalog_status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "store_members_store_user_unique" ON "store_members" ("store_id","user_id");--> statement-breakpoint
CREATE INDEX "store_members_store_status_idx" ON "store_members" ("store_id","status");--> statement-breakpoint
-- Every existing community idea goes back to Suggested so each one is reviewed (recommend, then add to catalog).
UPDATE "public_items" SET "catalog_status" = 'pending' WHERE "catalog_status" = 'none' AND "catalog_item_id" IS NULL;
