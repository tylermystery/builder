CREATE TABLE "promotion_redemptions" (
	"id" serial PRIMARY KEY,
	"promotion_id" integer NOT NULL,
	"user_id" text,
	"session_id" text,
	"payment_intent_id" text,
	"amount_cents" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reward_type" text DEFAULT 'percent' NOT NULL,
	"reward_value" integer NOT NULL,
	"scope_type" text DEFAULT 'store' NOT NULL,
	"target" text,
	"eligibility_mode" text DEFAULT 'fixed_end' NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"window_days" integer,
	"max_redemptions" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "promotion_redemptions_promo_idx" ON "promotion_redemptions" ("promotion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_redemptions_pi_unique" ON "promotion_redemptions" ("promotion_id","payment_intent_id");--> statement-breakpoint
CREATE INDEX "promotions_store_idx" ON "promotions" ("store_id");--> statement-breakpoint
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_promotions_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE;