# CRM Email Integration Setup

The CRM implementation is tenant-scoped but initially enrolls only the Tyler's Mystery Tours store owner. The dashboard is available at `/crm.html` after signing in through the main WhatTheFun authentication flow.

## Required Environment Configuration

Set these values in Netlify environment configuration. Do not place values in source files.

### CRM security

- `CRM_TOKEN_ENCRYPTION_KEY`: Long random secret used to encrypt Google refresh tokens.
- `CRM_SIGNING_SECRET`: Long random secret used for OAuth state and unsubscribe links. The app can fall back to `JWT_SECRET`, but a separate value is recommended.
- `CRM_INTERNAL_SECRET`: Long random secret used only for scheduled-to-background function dispatch.
- `CRM_PILOT_OWNER_EMAIL`: Set to the Tyler's Mystery Tours owner email. The code defaults to the agreed pilot owner.
- `CRM_PILOT_STORE_ID`: Optional Airtable store record ID. When omitted, the owner’s first linked store is used.
- `CRM_ALLOW_PUBLISHERS`: Leave unset for the owner-only pilot. Set to `true` only after publisher access is ready to launch.
- `CRM_INGEST_WEBHOOK_SECRET`: Required if the legacy `/api/process-email` webhook remains in use.

### Google mailbox connection

- `GOOGLE_CRM_CLIENT_ID`
- `GOOGLE_CRM_CLIENT_SECRET`
- `GOOGLE_CRM_REDIRECT_URI`: Optional when the canonical Netlify `URL` is available. The redirect path is `/api/crm/google/callback`.

Configure the Google OAuth client for web application access and add the production callback URL. The connector requests read-only Gmail access and does not request permission to send mail.

Reading Gmail content can require Google OAuth verification and additional review before unrelated store owners can connect. Complete that process before expanding beyond explicitly authorized pilot users.

### Marketing email

- `SENDGRID_API_KEY`: Existing Twilio SendGrid key used by the application.
- `CRM_MARKETING_FROM_EMAIL`: Verified Tyler's Mystery Tours marketing sender.
- `CRM_MARKETING_FROM_NAME`: Sender display name.
- `CRM_MARKETING_REPLY_TO`: Monitored reply mailbox.
- `CRM_BUSINESS_ADDRESS`: Valid physical mailing address appended to every marketing message.
- `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY`: Public verification key from SendGrid’s signed Event Webhook settings.
- `CRM_CAMPAIGN_RECIPIENT_LIMIT`: Defaults to `50` for the first rollout wave. Raise deliberately after reviewing delivery quality.
- `CRM_RELATIONSHIP_DISCLOSURE`: Optional replacement for the default prior-relationship explanation appended to marketing messages.
- `CRM_ALLOW_UNSIGNED_WEBHOOKS`: Never enable in production. It exists only for controlled local testing.

Configure the SendGrid Event Webhook destination as `/api/crm/sendgrid-events` and enable signature verification. Subscribe to processed, delivered, deferred, bounce, dropped, spam report, unsubscribe, and group unsubscribe events.

## Netlify AI Gateway

The email enrichment helper uses `gpt-5.4-mini` through Netlify AI Gateway. It returns structured contact names, companies, relationship summaries, and suggested action items. It does not infer consent.

Set `CRM_AI_ENRICHMENT=false` to run deterministic parsing without AI. When AI Gateway is unavailable, ingestion continues with deterministic summaries instead of failing the mailbox sync.

## Database Migration

The CRM schema is defined in `db/schema.ts`. Its generated migration is:

`netlify/database/migrations/20260811064629_create_crm_email_marketing/migration.sql`

This migration is additive and does not modify existing application tables. It remains part of the current unapplied migration set and should be deployed through the normal Netlify Database migration process. Do not reset or regenerate unrelated pending migrations.

## Security Prerequisite

The previously browser-exposed Airtable credential was removed from CRM code, but the external credential itself must still be revoked and replaced in Airtable and Netlify configuration. Source changes cannot rotate an external credential.

Complete rotation before treating the CRM as production-ready.

## Pilot Workflow

1. Sign in through the main WhatTheFun account flow as the Tyler's Mystery Tours owner.
2. Open `/crm.html` and select **Contacts & Email**.
3. Connect the Google mailbox.
4. Start the historical import. The importer processes bounded pages and continues every ten minutes.
5. Review candidate contacts. Two-way email creates candidates but never explicit newsletter subscriptions.
6. Confirm or reject contacts and inspect store-private email activity on linked plans.
7. Create a campaign draft and send a test message to the signed-in owner.
8. Approve the immutable audience. The default first-wave cap is 50 recipients.
9. Start the background send only after SendGrid event verification and the business address are configured.
10. Review bounces, complaints, unsubscribes, replies, and relationship matching before increasing the recipient cap.

## Continuous Synchronization

`crm-sync-schedule.ts` runs every ten minutes. It dispatches bounded mailbox jobs, processes Gmail history increments, updates contact activity, and creates store-private plan interactions. Invalid history cursors trigger a bounded 30-day recovery sync rather than repeating the complete 24-month import.

The current implementation polls Gmail for the pilot. Gmail push notifications through Google Cloud Pub/Sub can be added later without replacing the stored connection, history cursor, job, or interaction model.

## Privacy Boundaries

- Imported email appears only in the store-private CRM timeline.
- Email is not inserted into collaborative plan chat.
- Redacted excerpts expire after 90 days.
- Complete mailbox bodies are not retained by default.
- OAuth tokens are encrypted at rest.
- Logs avoid message bodies, tokens, and contact payloads.
- Unsubscribe, complaint, and hard-bounce events suppress future marketing sends.
