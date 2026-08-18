// db/schema.ts
//
// Schema for the public community layer (the "What The Fun" public catalog).
//
// Background: AI-generated, custom/manual and "solution" items have historically
// lived only as JSON embedded inside a single plan's saved session (the `aiRecords`
// portion of a session's "Items with Variations"). They were therefore private to
// the one plan that created them, and reactions/comments were per-plan too.
//
// These tables promote that content into a shared, queryable layer so that
// AI/custom items become public within their originating store, and reactions and
// comments are aggregated onto the public item. The schema is intentionally
// "variation-aware" up front: reactions and comments carry an optional variation
// reference so per-variation UI can be added later without a migration, and
// user-authored variations link back to their parent public item (explicit-edit
// lineage) without auto-grouping unrelated items.
//
// All external identifiers (Airtable store ids, session ids, original client item
// ids, and user ids) are stored as text because they originate in Airtable, not in
// this Postgres database. There are intentionally no cross-system foreign keys.

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// A public item: a promoted AI / custom / solution item, visible to everyone
// browsing its originating store.
export const publicItems = pgTable(
  "public_items",
  {
    id: serial().primaryKey(),
    // Airtable store record id — enforces "public within the originating store".
    storeId: text("store_id").notNull(),
    // 'ai' | 'custom' | 'solution' | 'catalog'
    // 'catalog' marks a lightweight community container created lazily the first
    // time someone reacts to / comments on an EXISTING curated catalog item. Such
    // a row is not a promoted idea in its own right — it only holds the shared
    // (community) reactions and comments for that catalog item, keyed below.
    source: text("source").notNull(),
    // For source='catalog': the stable Airtable id of the curated catalog item
    // this row carries community reactions/comments for. Null for promoted
    // AI/custom/solution ideas (which are items in their own right).
    catalogItemId: text("catalog_item_id"),
    // Provenance back into the legacy session JSON (used for idempotent backfill).
    originSessionId: text("origin_session_id"),
    originItemId: text("origin_item_id"),
    // Creator / attributed author (an Airtable user record id). May be null for
    // community/unattributed migrated content.
    authorId: text("author_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    // Price is kept as free text because it can be a single value or a range.
    price: text("price"),
    // The full original record so the existing UI can render it faithfully.
    data: jsonb("data"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("public_items_store_idx").on(t.storeId),
    // Idempotent backfill: the same (session, original item) maps to one row.
    // Net-new items created through the API leave these null and never collide.
    originUnique: uniqueIndex("public_items_origin_unique").on(
      t.originSessionId,
      t.originItemId,
    ),
    // At most one community container per (store, catalog item). catalog_item_id
    // is null for promoted ideas, and Postgres treats those nulls as distinct, so
    // promoted ideas never collide here — only catalog containers are deduped.
    catalogItemUnique: uniqueIndex("public_items_catalog_item_unique").on(
      t.storeId,
      t.catalogItemId,
    ),
  }),
);

// Curated similar-offering overrides for catalog detail pages. These rows are
// directional: configuring item A does not implicitly change item B. When an
// item has no rows, the client derives recommendations from catalog metadata.
export const similarOfferings = pgTable(
  "similar_offerings",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    catalogItemId: text("catalog_item_id").notNull(),
    relatedCatalogItemId: text("related_catalog_item_id").notNull(),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("similar_offerings_item_idx").on(t.storeId, t.catalogItemId),
    pairUnique: uniqueIndex("similar_offerings_pair_unique").on(
      t.storeId,
      t.catalogItemId,
      t.relatedCatalogItemId,
    ),
  }),
);

// A user-authored variation/edit of a public item. Created by explicitly editing
// an existing public item, which records the parent/lineage link. Independently
// created items remain separate public items rather than being auto-merged.
export const itemVariations = pgTable(
  "item_variations",
  {
    id: serial().primaryKey(),
    publicItemId: integer("public_item_id")
      .notNull()
      .references(() => publicItems.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    name: text("name"),
    description: text("description"),
    imageUrl: text("image_url"),
    price: text("price"),
    data: jsonb("data"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("item_variations_item_idx").on(t.publicItemId),
  }),
);

// A reaction (one emoji from one user). The multi-emoji democratic model means a
// user can have several reaction rows on the same target. `variationId` is null
// for item-level reactions and set for per-variation reactions. `commentId` is
// null for item/variation reactions and set when the reaction targets a single
// comment (so community comments can be reacted to like plan chat messages).
export const reactions = pgTable(
  "reactions",
  {
    id: serial().primaryKey(),
    publicItemId: integer("public_item_id")
      .notNull()
      .references(() => publicItems.id, { onDelete: "cascade" }),
    variationId: integer("variation_id").references(() => itemVariations.id, {
      onDelete: "cascade",
    }),
    commentId: integer("comment_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("reactions_item_idx").on(t.publicItemId),
    commentIdx: index("reactions_comment_idx").on(t.commentId),
  }),
);

// A comment, aggregated onto the public item. `variationId` is null for
// item-level comments and set for per-variation comments (future UI).
// `parentCommentId` is null for top-level comments and set for replies, giving
// community comments the same one-level threaded replies as plan chat messages.
export const comments = pgTable(
  "comments",
  {
    id: serial().primaryKey(),
    publicItemId: integer("public_item_id")
      .notNull()
      .references(() => publicItems.id, { onDelete: "cascade" }),
    variationId: integer("variation_id").references(() => itemVariations.id, {
      onDelete: "cascade",
    }),
    parentCommentId: integer("parent_comment_id").references(
      (): AnyPgColumn => comments.id,
      { onDelete: "cascade" },
    ),
    userId: text("user_id").notNull(),
    authorName: text("author_name"),
    body: text("body").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("comments_item_idx").on(t.publicItemId),
    parentIdx: index("comments_parent_idx").on(t.parentCommentId),
  }),
);

// ---------------------------------------------------------------------------
// Promotions (deals / discounts)
//
// A promotion is one configurable record — a reward + a scope + a date gate +
// an optional scarcity limit — that the pricing engine evaluates against a
// cart. The three originally requested deals (a deadline percentage off, a
// "three then gone" item deal, and a last-minute rolling-window deal) are all
// rows of this one table rather than bespoke features.
//
// The definition lives here in Postgres (one place, fully under code control,
// and — critically — the redemption counter below needs Postgres' transactional
// guarantees, which Airtable cannot provide). All external identifiers (the
// owning Airtable store id, the targeted item/store id, the author user id) are
// stored as text, matching the no-cross-FK convention used by the tables above.
export const promotions = pgTable(
  "promotions",
  {
    id: serial().primaryKey(),
    // Airtable store record id that owns the deal. Also the permission anchor:
    // only that store's PublishPermission holders may author/edit it.
    storeId: text("store_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Reward: 'percent' (reward_value is a whole-number percent, e.g. 25) or
    // 'amount' (reward_value is a discount in cents).
    rewardType: text("reward_type").notNull().default("percent"),
    rewardValue: integer("reward_value").notNull(),
    // What the deal applies to: 'item' (target = item record id), 'store'
    // (every item in this store; target ignored), or 'category' (target = a
    // base-category label, matched case/space-insensitively, store-scoped).
    scopeType: text("scope_type").notNull().default("store"),
    target: text("target"),
    // Date gate — exactly one mode is read. 'fixed_end': live between
    // starts_at (optional) and ends_at (a shared deadline for everyone).
    // 'rolling': true last-minute behaviour — eligible only while the cart
    // line's event date is within window_days of today.
    eligibilityMode: text("eligibility_mode").notNull().default("fixed_end"),
    startsAt: timestamp("starts_at"),
    endsAt: timestamp("ends_at"),
    windowDays: integer("window_days"),
    // Scarcity: max redemptions across all customers (null = unlimited). One
    // checkout consumes one redemption regardless of how many lines matched.
    maxRedemptions: integer("max_redemptions"),
    active: boolean("active").notNull().default(true),
    // Author (Airtable user record id) for audit.
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("promotions_store_idx").on(t.storeId),
  }),
);

// One row per redemption (one successful checkout that applied a promotion).
// Written from the payment-confirmation path under a transaction that locks the
// promotion row, so the "three then gone" limit can never be oversold by
// concurrent checkouts. Idempotent on (promotion, payment intent) so a webhook
// retry does not double-count.
export const promotionRedemptions = pgTable(
  "promotion_redemptions",
  {
    id: serial().primaryKey(),
    promotionId: integer("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    sessionId: text("session_id"),
    paymentIntentId: text("payment_intent_id"),
    amountCents: integer("amount_cents"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    promoIdx: index("promotion_redemptions_promo_idx").on(t.promotionId),
    // A given payment intent redeems a given promotion at most once.
    piUnique: uniqueIndex("promotion_redemptions_pi_unique").on(
      t.promotionId,
      t.paymentIntentId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Member groups (store-defined collections of people)
//
// A group is a named collection of people that belongs to exactly one store —
// for example a "Membership" group under the "Union Machine Works" store. The
// definition lives here in Postgres (the no-cross-FK convention again: the
// owning store and every member are Airtable record ids stored as text). This
// keeps membership integrity — uniqueness, counts, cascade cleanup — in the
// system best suited for it while still anchoring each group to its Airtable
// store and each membership to an Airtable user.
//
// Permissioning mirrors promotions exactly: the store's PublishPermission
// holders are the only people who may create a group, edit it, or change who
// belongs to it. A person may belong to many groups.
export const groups = pgTable(
  "groups",
  {
    id: serial().primaryKey(),
    // Airtable store record id that owns the group. Also the permission anchor:
    // only that store's PublishPermission holders may author/edit it.
    storeId: text("store_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Optional short kind/label so a group can be tagged, e.g. "membership" or
    // "crew". Free text; null when unset.
    kind: text("kind"),
    // Optional group picture (a Cloudinary URL, consistent with the app's other
    // image handling). Null when unset.
    imageUrl: text("image_url"),
    // Stable, globally-unique slug used to address the group's public page.
    slug: text("slug").notNull(),
    // 'public'  — the group page is viewable by anyone with the link.
    // 'private' — only the store's publishers and the group's own members may
    //             view the page; everyone else gets a "this group is private"
    //             response.
    visibility: text("visibility").notNull().default("public"),
    // Author (Airtable user record id) for audit.
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("groups_store_idx").on(t.storeId),
    slugUnique: uniqueIndex("groups_slug_unique").on(t.slug),
  }),
);

// ---------------------------------------------------------------------------
// Event RSVPs (party size per guest)
//
// The yes / maybe / no MEMBERSHIP of an event RSVP continues to live in Airtable
// (the event record's RSVPs / RSVPMaybe / RSVPNo link fields) — that storage is
// untouched. This table is purely additive: it records the PARTY SIZE — the
// "number of RSVPs" a single guest is reserving — alongside their response, so a
// guest can RSVP for more than one spot. One row per (event, guest); the same
// no-cross-FK convention applies (the Airtable event id and user id are text).
//
// Guests who responded before this feature simply have no row and are counted as
// a party of one, so totals stay correct without a backfill.
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: serial().primaryKey(),
    // Airtable event (catalog item) record id.
    eventId: text("event_id").notNull(),
    // Airtable user record id of the guest.
    userId: text("user_id").notNull(),
    // Mirrors the guest's Airtable response: 'yes' | 'maybe' | 'no'. Kept here so
    // headcount totals can be summed per response without a second lookup.
    rsvpType: text("rsvp_type").notNull().default("yes"),
    // Party size — how many spots this guest is reserving. Always >= 1.
    quantity: integer("quantity").notNull().default(1),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    eventIdx: index("event_rsvps_event_idx").on(t.eventId),
    // A guest holds at most one party-size row per event (upserted on response).
    eventUserUnique: uniqueIndex("event_rsvps_event_user_unique").on(
      t.eventId,
      t.userId,
    ),
  }),
);

// One row per membership (one person in one group). Cascade-deleted with the
// group. Unique on (group, user) so a person cannot be added to the same group
// twice; the same person can still belong to many different groups.
export const groupMembers = pgTable(
  "group_members",
  {
    id: serial().primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    // Airtable user record id.
    userId: text("user_id").notNull(),
    // Optional group-specific display details. These let store publishers add
    // simple member cards even when the Airtable Users table has only a minimal
    // record for that person.
    displayName: text("display_name"),
    bio: text("bio"),
    imageUrls: jsonb("image_urls"),
    memberEmail: text("member_email"),
    storeName: text("store_name"),
    storeUrl: text("store_url"),
    // 'member' (default) or 'admin' (a member with elevated standing within the
    // group). Store-level publish permission, not this role, governs who can
    // edit the group itself.
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").defaultNow(),
  },
  (t) => ({
    groupIdx: index("group_members_group_idx").on(t.groupId),
    memberUnique: uniqueIndex("group_members_unique").on(t.groupId, t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Store-scoped CRM, mailbox synchronization, and marketing campaigns.
//
// CRM data lives in Postgres while stores, users, and plans continue to use
// Airtable record ids. Every tenant-owned row carries store_id so the Tyler's
// Mystery Tours pilot can expand without changing the storage model.
export const crmStoreEnrollments = pgTable(
  "crm_store_enrollments",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    status: text("status").notNull().default("pilot"),
    mailboxLimit: integer("mailbox_limit").notNull().default(1),
    contactLimit: integer("contact_limit").notNull().default(2000),
    monthlyRecipientLimit: integer("monthly_recipient_limit").notNull().default(2000),
    enabledAt: timestamp("enabled_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeUnique: uniqueIndex("crm_store_enrollments_store_unique").on(t.storeId),
  }),
);

export const crmStoreAccess = pgTable(
  "crm_store_access",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    userId: text("user_id"),
    userEmail: text("user_email").notNull(),
    role: text("role").notNull().default("owner"),
    capabilities: jsonb("capabilities"),
    permissionSource: text("permission_source").notNull().default("pilot_owner"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("crm_store_access_store_idx").on(t.storeId),
    storeEmailUnique: uniqueIndex("crm_store_access_store_email_unique").on(
      t.storeId,
      t.userEmail,
    ),
  }),
);

export const crmMailboxConnections = pgTable(
  "crm_mailbox_connections",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    provider: text("provider").notNull().default("google"),
    mailboxEmail: text("mailbox_email").notNull(),
    providerAccountId: text("provider_account_id"),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    tokenVersion: integer("token_version").notNull().default(1),
    scopes: jsonb("scopes"),
    status: text("status").notNull().default("active"),
    connectedByUserId: text("connected_by_user_id"),
    connectedByEmail: text("connected_by_email").notNull(),
    tokenExpiresAt: timestamp("token_expires_at"),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("crm_mailbox_connections_store_idx").on(t.storeId),
    storeMailboxUnique: uniqueIndex("crm_mailbox_store_email_unique").on(
      t.storeId,
      t.mailboxEmail,
    ),
  }),
);

export const crmMailboxSyncState = pgTable(
  "crm_mailbox_sync_state",
  {
    id: serial().primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => crmMailboxConnections.id, { onDelete: "cascade" }),
    storeId: text("store_id").notNull(),
    stream: text("stream").notNull().default("all_mail"),
    historyId: text("history_id"),
    backfillAfter: timestamp("backfill_after"),
    backfillPageToken: text("backfill_page_token"),
    backfillComplete: boolean("backfill_complete").notNull().default(false),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
    nextSyncAt: timestamp("next_sync_at").defaultNow(),
    failureCount: integer("failure_count").notNull().default(0),
    recoveryState: text("recovery_state"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    dueIdx: index("crm_mailbox_sync_due_idx").on(t.nextSyncAt),
    connectionStreamUnique: uniqueIndex("crm_mailbox_sync_stream_unique").on(
      t.connectionId,
      t.stream,
    ),
  }),
);

export const crmSyncJobs = pgTable(
  "crm_sync_jobs",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => crmMailboxConnections.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    progress: jsonb("progress"),
    attempts: integer("attempts").notNull().default(0),
    errorCategory: text("error_category"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeStatusIdx: index("crm_sync_jobs_store_status_idx").on(t.storeId, t.status),
    idempotencyUnique: uniqueIndex("crm_sync_jobs_idempotency_unique").on(
      t.idempotencyKey,
    ),
  }),
);

export const crmEmailThreads = pgTable(
  "crm_email_threads",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => crmMailboxConnections.id, { onDelete: "cascade" }),
    providerThreadId: text("provider_thread_id").notNull(),
    subject: text("subject"),
    participants: jsonb("participants"),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),
    relationshipState: text("relationship_state").notNull().default("unknown"),
    extractionStatus: text("extraction_status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeLastIdx: index("crm_email_threads_store_last_idx").on(t.storeId, t.lastMessageAt),
    providerThreadUnique: uniqueIndex("crm_email_thread_provider_unique").on(
      t.connectionId,
      t.providerThreadId,
    ),
  }),
);

export const crmEmailMessages = pgTable(
  "crm_email_messages",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => crmEmailThreads.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    direction: text("direction").notNull(),
    senderEmail: text("sender_email"),
    recipientEmails: jsonb("recipient_emails"),
    ccEmails: jsonb("cc_emails"),
    sentAt: timestamp("sent_at"),
    subject: text("subject"),
    redactedExcerpt: text("redacted_excerpt"),
    excerptExpiresAt: timestamp("excerpt_expires_at"),
    payloadHash: text("payload_hash"),
    processingStatus: text("processing_status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    threadSentIdx: index("crm_email_messages_thread_sent_idx").on(t.threadId, t.sentAt),
    providerMessageUnique: uniqueIndex("crm_email_message_provider_unique").on(
      t.storeId,
      t.providerMessageId,
    ),
  }),
);

export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    displayName: text("display_name"),
    company: text("company"),
    relationshipSummary: text("relationship_summary"),
    lifecycleStage: text("lifecycle_stage").notNull().default("past_client"),
    relationshipState: text("relationship_state").notNull().default("candidate"),
    marketingPermission: text("marketing_permission")
      .notNull()
      .default("unconfirmed_relationship"),
    lastInteractionAt: timestamp("last_interaction_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeLastIdx: index("crm_contacts_store_last_idx").on(t.storeId, t.lastInteractionAt),
    storeEmailUnique: uniqueIndex("crm_contacts_store_email_unique").on(
      t.storeId,
      t.normalizedEmail,
    ),
  }),
);

export const crmContactSources = pgTable(
  "crm_contact_sources",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    threadId: integer("thread_id").references(() => crmEmailThreads.id, {
      onDelete: "set null",
    }),
    qualificationReason: text("qualification_reason").notNull(),
    confidence: integer("confidence"),
    extractedFields: jsonb("extracted_fields"),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    contactIdx: index("crm_contact_sources_contact_idx").on(t.contactId),
  }),
);

export const crmContactPlanLinks = pgTable(
  "crm_contact_plan_links",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull(),
    threadId: integer("thread_id").references(() => crmEmailThreads.id, {
      onDelete: "set null",
    }),
    confidence: integer("confidence"),
    status: text("status").notNull().default("suggested"),
    confirmedByUserId: text("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    planIdx: index("crm_contact_plan_links_plan_idx").on(t.storeId, t.planId),
    contactPlanUnique: uniqueIndex("crm_contact_plan_unique").on(
      t.contactId,
      t.planId,
    ),
  }),
);

export const crmInteractions = pgTable(
  "crm_interactions",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    contactId: integer("contact_id").references(() => crmContacts.id, {
      onDelete: "cascade",
    }),
    planId: text("plan_id"),
    interactionType: text("interaction_type").notNull(),
    sourceId: text("source_id"),
    summary: text("summary").notNull(),
    actionItems: jsonb("action_items"),
    visibility: text("visibility").notNull().default("store_private"),
    occurredAt: timestamp("occurred_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    planOccurredIdx: index("crm_interactions_plan_occurred_idx").on(
      t.storeId,
      t.planId,
      t.occurredAt,
    ),
    sourceUnique: uniqueIndex("crm_interactions_source_unique").on(
      t.storeId,
      t.interactionType,
      t.sourceId,
    ),
  }),
);

export const crmConsentEvents = pgTable(
  "crm_consent_events",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    contactId: integer("contact_id")
      .notNull()
      .references(() => crmContacts.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("marketing"),
    state: text("state").notNull(),
    source: text("source").notNull(),
    evidence: text("evidence"),
    actorUserId: text("actor_user_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    contactCreatedIdx: index("crm_consent_contact_created_idx").on(
      t.contactId,
      t.createdAt,
    ),
  }),
);

export const crmSuppressions = pgTable(
  "crm_suppressions",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    contactId: integer("contact_id").references(() => crmContacts.id, {
      onDelete: "set null",
    }),
    normalizedEmail: text("normalized_email").notNull(),
    suppressionType: text("suppression_type").notNull(),
    source: text("source").notNull(),
    providerEventId: text("provider_event_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    storeEmailIdx: index("crm_suppressions_store_email_idx").on(
      t.storeId,
      t.normalizedEmail,
    ),
    providerEventUnique: uniqueIndex("crm_suppression_provider_event_unique").on(
      t.providerEventId,
    ),
  }),
);

export const crmTemplates = pgTable(
  "crm_templates",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    status: text("status").notNull().default("draft"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeIdx: index("crm_templates_store_idx").on(t.storeId),
  }),
);

export const crmCampaigns = pgTable(
  "crm_campaigns",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    templateId: integer("template_id").references(() => crmTemplates.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name").notNull(),
    replyToEmail: text("reply_to_email"),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at"),
    audienceCounts: jsonb("audience_counts"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    storeStatusIdx: index("crm_campaigns_store_status_idx").on(t.storeId, t.status),
  }),
);

export const crmCampaignRecipients = pgTable(
  "crm_campaign_recipients",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => crmCampaigns.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => crmContacts.id, {
      onDelete: "set null",
    }),
    normalizedEmail: text("normalized_email").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("pending"),
    suppressionReason: text("suppression_reason"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    campaignStatusIdx: index("crm_campaign_recipients_status_idx").on(
      t.campaignId,
      t.status,
    ),
    campaignEmailUnique: uniqueIndex("crm_campaign_recipient_email_unique").on(
      t.campaignId,
      t.normalizedEmail,
    ),
    idempotencyUnique: uniqueIndex("crm_campaign_recipient_idempotency_unique").on(
      t.idempotencyKey,
    ),
  }),
);

export const crmEmailEvents = pgTable(
  "crm_email_events",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    campaignId: integer("campaign_id").references(() => crmCampaigns.id, {
      onDelete: "set null",
    }),
    recipientId: integer("recipient_id").references(() => crmCampaignRecipients.id, {
      onDelete: "set null",
    }),
    providerEventId: text("provider_event_id").notNull(),
    providerMessageId: text("provider_message_id"),
    normalizedEmail: text("normalized_email"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    providerEventUnique: uniqueIndex("crm_email_events_provider_unique").on(
      t.providerEventId,
    ),
    campaignOccurredIdx: index("crm_email_events_campaign_idx").on(
      t.campaignId,
      t.occurredAt,
    ),
  }),
);

export const crmAuditLog = pgTable(
  "crm_audit_log",
  {
    id: serial().primaryKey(),
    storeId: text("store_id").notNull(),
    actorUserId: text("actor_user_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    storeCreatedIdx: index("crm_audit_store_created_idx").on(t.storeId, t.createdAt),
  }),
);
