CREATE TABLE "event_rsvps" (
	"id" serial PRIMARY KEY,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rsvp_type" text DEFAULT 'yes' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "event_rsvps_event_idx" ON "event_rsvps" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_rsvps_event_user_unique" ON "event_rsvps" ("event_id","user_id");