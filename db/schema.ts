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
} from "drizzle-orm/pg-core";

// A public item: a promoted AI / custom / solution item, visible to everyone
// browsing its originating store.
export const publicItems = pgTable(
  "public_items",
  {
    id: serial().primaryKey(),
    // Airtable store record id — enforces "public within the originating store".
    storeId: text("store_id").notNull(),
    // 'ai' | 'custom' | 'solution'
    source: text("source").notNull(),
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
// for item-level reactions and set for per-variation reactions.
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
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("reactions_item_idx").on(t.publicItemId),
  }),
);

// A comment, aggregated onto the public item. `variationId` is null for
// item-level comments and set for per-variation comments (future UI).
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
    userId: text("user_id").notNull(),
    authorName: text("author_name"),
    body: text("body").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    itemIdx: index("comments_item_idx").on(t.publicItemId),
  }),
);
