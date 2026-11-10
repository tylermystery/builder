CREATE TABLE "plan_history" (
	"id" serial PRIMARY KEY,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"changes" jsonb NOT NULL,
	"merged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "plan_history_session_created_idx" ON "plan_history" ("session_id","created_at");