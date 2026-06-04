CREATE TABLE "group_members" (
	"id" serial PRIMARY KEY,
	"group_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text,
	"image_url" text,
	"slug" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "group_members_group_idx" ON "group_members" ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_unique" ON "group_members" ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "groups_store_idx" ON "groups" ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_slug_unique" ON "groups" ("slug");--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;