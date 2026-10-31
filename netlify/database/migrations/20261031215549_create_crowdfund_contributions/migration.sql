CREATE TABLE "crowdfund_contributions" (
	"id" serial PRIMARY KEY,
	"fund_key" text NOT NULL,
	"item_name" text,
	"store_id" text,
	"payment_intent_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"session_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crowdfund_contributions_pi_unique" ON "crowdfund_contributions" ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "crowdfund_contributions_fund_key_idx" ON "crowdfund_contributions" ("fund_key");