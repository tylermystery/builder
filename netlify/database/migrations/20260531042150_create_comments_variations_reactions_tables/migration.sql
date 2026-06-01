CREATE TABLE "comments" (
	"id" serial PRIMARY KEY,
	"public_item_id" integer NOT NULL,
	"variation_id" integer,
	"user_id" text NOT NULL,
	"author_name" text,
	"body" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "item_variations" (
	"id" serial PRIMARY KEY,
	"public_item_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"name" text,
	"description" text,
	"image_url" text,
	"price" text,
	"data" jsonb,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "public_items" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"source" text NOT NULL,
	"origin_session_id" text,
	"origin_item_id" text,
	"author_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"price" text,
	"data" jsonb,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" serial PRIMARY KEY,
	"public_item_id" integer NOT NULL,
	"variation_id" integer,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "comments_item_idx" ON "comments" ("public_item_id");--> statement-breakpoint
CREATE INDEX "item_variations_item_idx" ON "item_variations" ("public_item_id");--> statement-breakpoint
CREATE INDEX "public_items_store_idx" ON "public_items" ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_items_origin_unique" ON "public_items" ("origin_session_id","origin_item_id");--> statement-breakpoint
CREATE INDEX "reactions_item_idx" ON "reactions" ("public_item_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_public_item_id_public_items_id_fkey" FOREIGN KEY ("public_item_id") REFERENCES "public_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_variation_id_item_variations_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "item_variations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "item_variations" ADD CONSTRAINT "item_variations_public_item_id_public_items_id_fkey" FOREIGN KEY ("public_item_id") REFERENCES "public_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_public_item_id_public_items_id_fkey" FOREIGN KEY ("public_item_id") REFERENCES "public_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_variation_id_item_variations_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "item_variations"("id") ON DELETE CASCADE;