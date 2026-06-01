ALTER TABLE "comments" ADD COLUMN "parent_comment_id" integer;--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "comment_id" integer;--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "reactions_comment_idx" ON "reactions" ("comment_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_id_comments_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE;