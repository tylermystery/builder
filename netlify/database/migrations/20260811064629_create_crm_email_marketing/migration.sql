CREATE TABLE "crm_audit_log" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"actor_user_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_recipients" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"campaign_id" integer NOT NULL,
	"contact_id" integer,
	"normalized_email" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"suppression_reason" text,
	"provider_message_id" text,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_campaigns" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"template_id" integer,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"from_email" text NOT NULL,
	"from_name" text NOT NULL,
	"reply_to_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"audience_counts" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_consent_events" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"contact_id" integer NOT NULL,
	"purpose" text DEFAULT 'marketing' NOT NULL,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"evidence" text,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contact_plan_links" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"contact_id" integer NOT NULL,
	"plan_id" text NOT NULL,
	"thread_id" integer,
	"confidence" integer,
	"status" text DEFAULT 'suggested' NOT NULL,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contact_sources" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"contact_id" integer NOT NULL,
	"thread_id" integer,
	"qualification_reason" text NOT NULL,
	"confidence" integer,
	"extracted_fields" jsonb,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"normalized_email" text NOT NULL,
	"display_name" text,
	"company" text,
	"relationship_summary" text,
	"lifecycle_stage" text DEFAULT 'past_client' NOT NULL,
	"relationship_state" text DEFAULT 'candidate' NOT NULL,
	"marketing_permission" text DEFAULT 'unconfirmed_relationship' NOT NULL,
	"last_interaction_at" timestamp,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_email_events" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"campaign_id" integer,
	"recipient_id" integer,
	"provider_event_id" text NOT NULL,
	"provider_message_id" text,
	"normalized_email" text,
	"event_type" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_email_messages" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"thread_id" integer NOT NULL,
	"provider_message_id" text NOT NULL,
	"direction" text NOT NULL,
	"sender_email" text,
	"recipient_emails" jsonb,
	"cc_emails" jsonb,
	"sent_at" timestamp,
	"subject" text,
	"redacted_excerpt" text,
	"excerpt_expires_at" timestamp,
	"payload_hash" text,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_email_threads" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"connection_id" integer NOT NULL,
	"provider_thread_id" text NOT NULL,
	"subject" text,
	"participants" jsonb,
	"first_message_at" timestamp,
	"last_message_at" timestamp,
	"relationship_state" text DEFAULT 'unknown' NOT NULL,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_interactions" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"contact_id" integer,
	"plan_id" text,
	"interaction_type" text NOT NULL,
	"source_id" text,
	"summary" text NOT NULL,
	"action_items" jsonb,
	"visibility" text DEFAULT 'store_private' NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_mailbox_connections" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"mailbox_email" text NOT NULL,
	"provider_account_id" text,
	"encrypted_refresh_token" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"scopes" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by_user_id" text,
	"connected_by_email" text NOT NULL,
	"token_expires_at" timestamp,
	"last_error" text,
	"last_error_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_mailbox_sync_state" (
	"id" serial PRIMARY KEY,
	"connection_id" integer NOT NULL,
	"store_id" text NOT NULL,
	"stream" text DEFAULT 'all_mail' NOT NULL,
	"history_id" text,
	"backfill_after" timestamp,
	"backfill_page_token" text,
	"backfill_complete" boolean DEFAULT false NOT NULL,
	"last_successful_sync_at" timestamp,
	"next_sync_at" timestamp DEFAULT now(),
	"failure_count" integer DEFAULT 0 NOT NULL,
	"recovery_state" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_store_access" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"user_id" text,
	"user_email" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"capabilities" jsonb,
	"permission_source" text DEFAULT 'pilot_owner' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_store_enrollments" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"status" text DEFAULT 'pilot' NOT NULL,
	"mailbox_limit" integer DEFAULT 1 NOT NULL,
	"contact_limit" integer DEFAULT 2000 NOT NULL,
	"monthly_recipient_limit" integer DEFAULT 2000 NOT NULL,
	"enabled_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_suppressions" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"contact_id" integer,
	"normalized_email" text NOT NULL,
	"suppression_type" text NOT NULL,
	"source" text NOT NULL,
	"provider_event_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_sync_jobs" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"connection_id" integer NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"progress" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_templates" (
	"id" serial PRIMARY KEY,
	"store_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "crm_audit_store_created_idx" ON "crm_audit_log" ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_campaign_recipients_status_idx" ON "crm_campaign_recipients" ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_recipient_email_unique" ON "crm_campaign_recipients" ("campaign_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_recipient_idempotency_unique" ON "crm_campaign_recipients" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "crm_campaigns_store_status_idx" ON "crm_campaigns" ("store_id","status");--> statement-breakpoint
CREATE INDEX "crm_consent_contact_created_idx" ON "crm_consent_events" ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_contact_plan_links_plan_idx" ON "crm_contact_plan_links" ("store_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contact_plan_unique" ON "crm_contact_plan_links" ("contact_id","plan_id");--> statement-breakpoint
CREATE INDEX "crm_contact_sources_contact_idx" ON "crm_contact_sources" ("contact_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_store_last_idx" ON "crm_contacts" ("store_id","last_interaction_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_store_email_unique" ON "crm_contacts" ("store_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_email_events_provider_unique" ON "crm_email_events" ("provider_event_id");--> statement-breakpoint
CREATE INDEX "crm_email_events_campaign_idx" ON "crm_email_events" ("campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "crm_email_messages_thread_sent_idx" ON "crm_email_messages" ("thread_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_email_message_provider_unique" ON "crm_email_messages" ("store_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "crm_email_threads_store_last_idx" ON "crm_email_threads" ("store_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_email_thread_provider_unique" ON "crm_email_threads" ("connection_id","provider_thread_id");--> statement-breakpoint
CREATE INDEX "crm_interactions_plan_occurred_idx" ON "crm_interactions" ("store_id","plan_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_interactions_source_unique" ON "crm_interactions" ("store_id","interaction_type","source_id");--> statement-breakpoint
CREATE INDEX "crm_mailbox_connections_store_idx" ON "crm_mailbox_connections" ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_mailbox_store_email_unique" ON "crm_mailbox_connections" ("store_id","mailbox_email");--> statement-breakpoint
CREATE INDEX "crm_mailbox_sync_due_idx" ON "crm_mailbox_sync_state" ("next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_mailbox_sync_stream_unique" ON "crm_mailbox_sync_state" ("connection_id","stream");--> statement-breakpoint
CREATE INDEX "crm_store_access_store_idx" ON "crm_store_access" ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_store_access_store_email_unique" ON "crm_store_access" ("store_id","user_email");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_store_enrollments_store_unique" ON "crm_store_enrollments" ("store_id");--> statement-breakpoint
CREATE INDEX "crm_suppressions_store_email_idx" ON "crm_suppressions" ("store_id","normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_suppression_provider_event_unique" ON "crm_suppressions" ("provider_event_id");--> statement-breakpoint
CREATE INDEX "crm_sync_jobs_store_status_idx" ON "crm_sync_jobs" ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sync_jobs_idempotency_unique" ON "crm_sync_jobs" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "crm_templates_store_idx" ON "crm_templates" ("store_id");--> statement-breakpoint
ALTER TABLE "crm_campaign_recipients" ADD CONSTRAINT "crm_campaign_recipients_campaign_id_crm_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_campaign_recipients" ADD CONSTRAINT "crm_campaign_recipients_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_template_id_crm_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm_templates"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_contact_plan_links" ADD CONSTRAINT "crm_contact_plan_links_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_contact_plan_links" ADD CONSTRAINT "crm_contact_plan_links_thread_id_crm_email_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "crm_email_threads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_contact_sources" ADD CONSTRAINT "crm_contact_sources_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_contact_sources" ADD CONSTRAINT "crm_contact_sources_thread_id_crm_email_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "crm_email_threads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_email_events" ADD CONSTRAINT "crm_email_events_campaign_id_crm_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_campaigns"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_email_events" ADD CONSTRAINT "crm_email_events_recipient_id_crm_campaign_recipients_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "crm_campaign_recipients"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_email_messages" ADD CONSTRAINT "crm_email_messages_thread_id_crm_email_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "crm_email_threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_email_threads" ADD CONSTRAINT "crm_email_threads_connection_id_crm_mailbox_connections_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_mailbox_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_interactions" ADD CONSTRAINT "crm_interactions_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_mailbox_sync_state" ADD CONSTRAINT "crm_mailbox_sync_state_FEixm5MaQwec_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_mailbox_connections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crm_suppressions" ADD CONSTRAINT "crm_suppressions_contact_id_crm_contacts_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "crm_sync_jobs" ADD CONSTRAINT "crm_sync_jobs_connection_id_crm_mailbox_connections_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crm_mailbox_connections"("id") ON DELETE CASCADE;