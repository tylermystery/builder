CREATE TABLE "similar_offerings" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"related_catalog_item_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "similar_offerings_item_idx" ON "similar_offerings" ("store_id","catalog_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "similar_offerings_pair_unique" ON "similar_offerings" ("store_id","catalog_item_id","related_catalog_item_id");