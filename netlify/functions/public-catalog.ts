// netlify/functions/public-catalog.ts
//
// Public community layer API. Reads are open to everyone (guests included);
// any write (creating a public item, adding a variation, reacting, commenting)
// requires a logged-in user. Authentication mirrors the rest of the app: a
// `Bearer <jwt>` token signed with JWT_SECRET whose payload carries `userId`.
//
// Routes (registered via `config.path`, no netlify.toml edit needed):
//   GET    /api/public-catalog?storeId=<airtableStoreId>
//   POST   /api/public-catalog/items        { storeId, source, name, description?, imageUrl?, price?, data?, originSessionId?, originItemId? }
//   POST   /api/public-catalog/variations   { publicItemId | (catalogItemId + storeId), name?, description?, imageUrl?, price?, data?, source?, label?, basedOnVariationId?, makeCurrent? }
//   POST   /api/public-catalog/reactions    { publicItemId | (catalogItemId + storeId) | commentId, variationId?, emoji }   (toggles)
//   POST   /api/public-catalog/comments     { publicItemId | (catalogItemId + storeId) | parentCommentId, variationId?, body, authorName? }
//   POST   /api/public-catalog/publish      { publicItemId } | { storeId, name, ... }   (publish-permission only)
//   POST   /api/public-catalog/unpublish    { publicItemId }                            (publish-permission only)
//   POST   /api/public-catalog/suggest      { publicItemId } | { storeId, name, ... }   (any signed-in user; lands as 'pending')
//   POST   /api/public-catalog/item-review  { publicItemId, decision, reviewNote? }     (publish-permission only)
//   POST   /api/public-catalog/variation-review { variationId, decision, reviewNote?, makeCurrent? }  (publish-permission only)
//   POST   /api/public-catalog/current-variation { publicItemId, variationId|null }     (publish-permission only)
//
// For reactions/comments, passing a `catalogItemId` (+ `storeId`) instead of a
// `publicItemId` lazily creates a community container (source='catalog') for that
// existing curated catalog item on first interaction, so any catalog item can
// gather shared reactions and comments without pre-seeding the whole catalog.
//   DELETE /api/public-catalog/comments     { id }      (author removes own)
//   DELETE /api/public-catalog/variations   { id }      (author removes own)
//   DELETE /api/public-catalog/items         { id }      (author OR a store's publish-permission user removes it)
//
// CATALOG STATUS (`public_items.catalog_status`)
// ---------------------------------------------
// 'none' is every row that predates this column: a community idea, surfaced in
// the client under the "Public Ideas" filter. 'published' means a publisher
// promoted it into the store's catalog, where it renders as an ordinary catalog
// item for everyone. 'pending' / 'rejected' are suggestions awaiting or denied
// review, and are returned ONLY to their author and to the store's publishers —
// the GET below reads the (optional) bearer token purely to make that call.
// Guests, and any request without a token, get exactly the same payload they
// got before this feature existed.
//
// VARIATIONS
// ----------
// A variation is an alternative version of an item (an edit, an AI rewrite, a
// manual rework) authored by any signed-in user. A publisher's variation is
// 'approved' immediately; anyone else's is 'pending' until a publisher approves
// or rejects it inline. `public_items.current_variation_id` records which
// version the CATALOG presents; it deliberately does not touch plans, which pin
// the version they were added with until their owner switches over.

import jwt from "jsonwebtoken";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  publicItems,
  itemVariations,
  reactions,
  comments,
} from "../../db/schema.js";

// Catalog statuses that are visible to everyone, signed in or not.
const PUBLIC_CATALOG_STATUSES = ["none", "published"];


const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

// Returns the authenticated userId, or null when the request is unauthenticated
// or the token is invalid/expired.
function getUserId(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret) as { userId?: string };
    return decoded && decoded.userId ? decoded.userId : null;
  } catch {
    return null;
  }
}

// Whether `userId` is allowed to moderate (e.g. delete) community content for the
// store `storeId`. True when the store's Airtable record lists the user in its
// PublishPermission field — the same list the front-end uses to gate publish-only
// controls. Fails closed (returns false) on any missing config or error so a
// misconfiguration can never silently widen who may delete other people's content.
//
// Results are memoised for PERMISSION_TTL_MS so that a catalog read by a signed-in
// user costs at most one extra Airtable request. The cache lives in module scope,
// which a warm function instance reuses; a cold start simply re-fetches. The TTL is
// short so revoking someone's publish permission takes effect promptly.
const PERMISSION_TTL_MS = 60_000;
const permissionCache = new Map<string, { value: boolean; expiresAt: number }>();

async function userHasPublishPermissionForStore(
  storeId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId || !storeId || !userId) return false;

  const cacheKey = `${storeId}:${userId}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let allowed = false;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/Stores/${encodeURIComponent(storeId)}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (res.ok) {
      const data = (await res.json()) as { fields?: { PublishPermission?: unknown } };
      const list = data?.fields?.PublishPermission;
      allowed = Array.isArray(list) && list.includes(userId);
    }
  } catch {
    allowed = false;
  }

  permissionCache.set(cacheKey, {
    value: allowed,
    expiresAt: Date.now() + PERMISSION_TTL_MS,
  });
  return allowed;
}

// Assemble the full public catalog for a store: items with their variations,
// aggregated reaction counts (and the set of emoji each user picked), and the
// comment thread. Hidden rows are excluded.
//
// `viewerId` (null for guests) and `viewerIsPublisher` decide whether rows that
// are not publicly visible — pending and rejected suggestions — are included.
// With no viewer, the visibility clause reduces to the pre-existing behaviour.
async function getCatalog(
  storeId: string,
  viewerId: string | null = null,
  viewerIsPublisher = false,
) {
  const visibleToViewer = viewerIsPublisher
    ? undefined // a publisher sees everything in their own store
    : viewerId
      ? or(
          inArray(publicItems.catalogStatus, PUBLIC_CATALOG_STATUSES),
          eq(publicItems.authorId, viewerId),
        )
      : inArray(publicItems.catalogStatus, PUBLIC_CATALOG_STATUSES);

  const items = await db
    .select()
    .from(publicItems)
    .where(
      and(
        eq(publicItems.storeId, storeId),
        eq(publicItems.hidden, false),
        ...(visibleToViewer ? [visibleToViewer] : []),
      ),
    );


  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);

  const [vars, reacts, cmts] = await Promise.all([
    db
      .select()
      .from(itemVariations)
      .where(
        and(
          inArray(itemVariations.publicItemId, itemIds),
          eq(itemVariations.hidden, false),
        ),
      ),
    db.select().from(reactions).where(inArray(reactions.publicItemId, itemIds)),
    db
      .select()
      .from(comments)
      .where(
        and(inArray(comments.publicItemId, itemIds), eq(comments.hidden, false)),
      ),
  ]);

  // Group children by their public item id. Variations awaiting (or denied at)
  // review are returned only to their author and to the store's publishers, the
  // same rule the item query above applies. Pre-existing rows default to
  // 'approved', so nothing that is visible today becomes invisible.
  const canSeeVariation = (v: (typeof vars)[number]) =>
    v.status === "approved" ||
    viewerIsPublisher ||
    (!!viewerId && v.authorId === viewerId);

  const byItem = (id: number) => ({
    variations: vars.filter((v) => v.publicItemId === id && canSeeVariation(v)),
    reactions: reacts.filter((r) => r.publicItemId === id),
    comments: cmts.filter((c) => c.publicItemId === id),
  });

  // Summarise reactions into per-emoji counts and the list of users per emoji,
  // optionally scoped to a variation (variationId === null => item-level). Comment
  // reactions (commentId set) are excluded here — they are summarised per comment.
  const summariseReactions = (
    rows: typeof reacts,
    variationId: number | null,
  ) => {
    const scoped = rows.filter(
      (r) =>
        r.commentId == null &&
        (variationId === null
          ? r.variationId == null
          : r.variationId === variationId),
    );
    const counts: Record<string, { count: number; users: string[] }> = {};
    for (const r of scoped) {
      if (!counts[r.emoji]) counts[r.emoji] = { count: 0, users: [] };
      counts[r.emoji].count += 1;
      counts[r.emoji].users.push(r.userId);
    }
    return counts;
  };

  // Summarise the reactions attached to one comment, same shape as above.
  const summariseCommentReactions = (rows: typeof reacts, commentId: number) => {
    const counts: Record<string, { count: number; users: string[] }> = {};
    for (const r of rows) {
      if (r.commentId !== commentId) continue;
      if (!counts[r.emoji]) counts[r.emoji] = { count: 0, users: [] };
      counts[r.emoji].count += 1;
      counts[r.emoji].users.push(r.userId);
    }
    return counts;
  };

  // Attach a reactions summary to each comment so the UI can render reaction
  // chips per comment, exactly like the per-item reaction summary.
  const withCommentReactions = (rows: typeof cmts) =>
    rows.map((c) => ({
      ...c,
      reactions: summariseCommentReactions(reacts, c.id),
    }));

  return items.map((item) => {
    const { variations, reactions: r, comments: c } = byItem(item.id);
    return {
      ...item,
      reactions: summariseReactions(r, null),
      comments: withCommentReactions(c.filter((x) => x.variationId == null)),
      variations: variations.map((v) => ({
        ...v,
        reactions: summariseReactions(r, v.id),
        comments: withCommentReactions(c.filter((x) => x.variationId === v.id)),
      })),
    };
  });
}

// Resolve the public item the current write targets. Two modes:
//   1. An explicit `publicItemId` (a promoted idea, or an already-created
//      catalog container) — returned as-is.
//   2. A `catalogItemId` (+ `storeId`) for an existing curated catalog item that
//      has no community container yet — lazily get-or-create one keyed by
//      (storeId, catalogItemId) and return its id. The unique index makes this
//      race-safe: a concurrent insert loses, and we re-read the winner's row.
// Returns null when neither identifier is usable.
async function resolvePublicItemId(
  body: Record<string, unknown>,
  userId: string,
): Promise<number | null> {
  if (body.publicItemId != null) return Number(body.publicItemId);

  const catalogItemId = body.catalogItemId == null ? null : String(body.catalogItemId);
  const storeId = body.storeId == null ? null : String(body.storeId);
  if (!catalogItemId || !storeId) return null;

  const find = () =>
    db
      .select()
      .from(publicItems)
      .where(
        and(
          eq(publicItems.storeId, storeId),
          eq(publicItems.catalogItemId, catalogItemId),
        ),
      );

  const existing = await find();
  if (existing.length > 0) return existing[0].id;

  try {
    const [row] = await db
      .insert(publicItems)
      .values({
        storeId,
        source: "catalog",
        catalogItemId,
        authorId: userId,
        name: body.name ? String(body.name) : "Catalog item",
        description: body.description ? String(body.description) : "",
        imageUrl: (body.imageUrl as string) ?? null,
        price: (body.price as string) ?? null,
        data: body.data ?? null,
      })
      .returning();
    return row.id;
  } catch {
    // Most likely the unique guard firing on a concurrent first-interaction.
    const again = await find();
    if (again.length > 0) return again[0].id;
    return null;
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  // Last path segment is the resource (items|variations|reactions|comments).
  const resource = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (req.method === "GET") {
      const storeId = url.searchParams.get("storeId");
      if (!storeId) return json(400, { error: "storeId is required" });
      // Reads stay open to everyone. A token is optional here and is used only to
      // decide whether this viewer may additionally see their own (or, for a
      // publisher, the store's) pending and rejected suggestions.
      const viewerId = getUserId(req);
      const viewerIsPublisher = viewerId
        ? await userHasPublishPermissionForStore(storeId, viewerId)
        : false;
      return json(200, {
        items: await getCatalog(storeId, viewerId, viewerIsPublisher),
        viewerIsPublisher,
      });
    }

    // Everything below is a write and requires authentication.
    const userId = getUserId(req);
    if (!userId) return json(401, { error: "Login required" });

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return json(400, { error: "Invalid JSON body" });

      if (resource === "items") {
        if (!body.storeId || !body.name)
          return json(400, { error: "storeId and name are required" });
        const [row] = await db
          .insert(publicItems)
          .values({
            storeId: String(body.storeId),
            source: body.source || "custom",
            originSessionId: body.originSessionId ?? null,
            originItemId: body.originItemId ?? null,
            authorId: userId,
            name: String(body.name),
            description: body.description || "",
            imageUrl: body.imageUrl ?? null,
            price: body.price ?? null,
            data: body.data ?? null,
          })
          .returning();
        return json(201, { item: row });
      }

      if (
        resource === "publish" ||
        resource === "unpublish" ||
        resource === "suggest"
      ) {
        // 'suggest' is the same flow for a user WITHOUT publish permission: the
        // row lands as 'pending' and the store's publishers review it inline in
        // the item's variation accordion.
        const suggesting = resource === "suggest";
        const publishing = resource === "publish";

        // Resolve the row this call targets. Three ways in, in priority order:
        //   1. an explicit publicItemId;
        //   2. the origin identity of an item that was already mirrored into the
        //      public layer by publish-on-add (session + original item id);
        //   3. nothing yet — a net-new item that only existed in the client, in
        //      which case publishing creates the row.
        // (2) matters because the AI/manual item in front of a publisher was very
        // likely auto-published as a community idea when they added it, and the
        // (origin_session_id, origin_item_id) unique index would reject a second
        // insert. Looking it up first makes "Add to store catalog" idempotent.
        let row: typeof publicItems.$inferSelect | undefined;

        if (body.publicItemId != null) {
          [row] = await db
            .select()
            .from(publicItems)
            .where(eq(publicItems.id, Number(body.publicItemId)));
          if (!row) return json(404, { error: "Not found" });
        } else if (body.originSessionId && body.originItemId) {
          [row] = await db
            .select()
            .from(publicItems)
            .where(
              and(
                eq(publicItems.originSessionId, String(body.originSessionId)),
                eq(publicItems.originItemId, String(body.originItemId)),
              ),
            );
        }

        // Unpublishing only ever acts on a row that already exists; publishing
        // and suggesting may both create one for an item that has never reached
        // the public layer.
        if (!row && !publishing && !suggesting) {
          return json(400, { error: "publicItemId is required" });
        }

        const storeId = row ? row.storeId : body.storeId ? String(body.storeId) : null;
        if (!storeId) return json(400, { error: "storeId is required" });

        // Permission is checked before anything is written. A suggestion needs
        // no permission — only a signed-in author, which the guard above gave us.
        if (
          !suggesting &&
          !(await userHasPublishPermissionForStore(storeId, userId))
        ) {
          return json(403, { error: "Forbidden" });
        }

        // Nobody may re-open a row that is already in the catalog by suggesting it.
        if (suggesting && row && row.catalogStatus === "published") {
          return json(400, { error: "This item is already in the catalog" });
        }

        // Only the author may put their own idea forward: moving someone else's
        // visible community idea to 'pending' would hide it from everyone but
        // them and the store's publishers.
        if (
          suggesting &&
          row &&
          row.authorId !== userId &&
          !(await userHasPublishPermissionForStore(storeId, userId))
        ) {
          return json(403, { error: "Forbidden" });
        }

        // A community container for an already-curated catalog item is not an
        // idea in its own right — promoting it would duplicate the curated item.
        if (row && row.catalogItemId) {
          return json(400, { error: "This item is already in the catalog" });
        }

        if (!row) {
          if (!body.name) return json(400, { error: "name is required" });
          try {
            const [created] = await db
              .insert(publicItems)
              .values({
                storeId,
                source: body.source ? String(body.source) : "custom",
                originSessionId: body.originSessionId ?? null,
                originItemId: body.originItemId ?? null,
                authorId: userId,
                name: String(body.name),
                description: body.description || "",
                imageUrl: body.imageUrl ?? null,
                price: body.price ?? null,
                data: body.data ?? null,
                catalogStatus: suggesting ? "pending" : "published",
                publishedAt: suggesting ? null : new Date(),
                publishedBy: suggesting ? null : userId,
              })
              .returning();
            return json(201, { item: created });
          } catch {
            // Most likely the origin unique index firing on a concurrent
            // publish-on-add; fall through to updating whichever row won.
            if (body.originSessionId && body.originItemId) {
              [row] = await db
                .select()
                .from(publicItems)
                .where(
                  and(
                    eq(publicItems.originSessionId, String(body.originSessionId)),
                    eq(publicItems.originItemId, String(body.originItemId)),
                  ),
                );
            }
            if (!row) return json(500, { error: "Could not publish item" });
          }
        }

        const nextStatus = suggesting
          ? { catalogStatus: "pending" }
          : publishing
            ? {
                catalogStatus: "published",
                publishedAt: new Date(),
                publishedBy: userId,
              }
            : { catalogStatus: "none" };

        const [updated] = await db
          .update(publicItems)
          .set(nextStatus)
          .where(eq(publicItems.id, row.id))
          .returning();

        return json(200, { item: updated });
      }

      // Publisher decision on a suggested item: approve puts it in the catalog,
      // reject leaves it visible to its author alone with the reviewer's note.
      if (resource === "item-review") {
        if (body.publicItemId == null)
          return json(400, { error: "publicItemId is required" });
        const decision = String(body.decision || "");
        if (decision !== "approve" && decision !== "reject")
          return json(400, { error: "decision must be approve or reject" });

        const [row] = await db
          .select()
          .from(publicItems)
          .where(eq(publicItems.id, Number(body.publicItemId)));
        if (!row) return json(404, { error: "Not found" });
        if (!(await userHasPublishPermissionForStore(row.storeId, userId)))
          return json(403, { error: "Forbidden" });

        const approved = decision === "approve";
        const [updated] = await db
          .update(publicItems)
          .set({
            catalogStatus: approved ? "published" : "rejected",
            reviewedAt: new Date(),
            reviewedBy: userId,
            reviewNote: body.reviewNote ? String(body.reviewNote) : null,
            ...(approved ? { publishedAt: new Date(), publishedBy: userId } : {}),
          })
          .where(eq(publicItems.id, row.id))
          .returning();

        return json(200, { item: updated });
      }

      if (resource === "variations") {
        // Like reactions and comments, a variation may target an existing public
        // row by id OR an ordinary curated catalog item by (catalogItemId +
        // storeId), in which case its community container is created on demand.
        // That is what lets anyone propose an edit to ANY item in the store.
        const itemId = await resolvePublicItemId(body, userId);
        if (itemId == null)
          return json(400, {
            error: "publicItemId or (catalogItemId + storeId) is required",
          });

        const [parent] = await db
          .select()
          .from(publicItems)
          .where(eq(publicItems.id, itemId));
        if (!parent) return json(404, { error: "Not found" });

        // A publisher's own variation is approved on the spot; everyone else's
        // is a suggestion the store's publishers review in the accordion.
        const isPublisher = await userHasPublishPermissionForStore(
          parent.storeId,
          userId,
        );
        const status = isPublisher ? "approved" : "pending";

        // Append to the end of the current list so the accordion keeps a stable,
        // chronological order without the client having to send a position.
        const siblings = await db
          .select()
          .from(itemVariations)
          .where(eq(itemVariations.publicItemId, itemId));
        const position = siblings.length;

        const [row] = await db
          .insert(itemVariations)
          .values({
            publicItemId: itemId,
            authorId: userId,
            name: body.name ?? null,
            description: body.description ?? null,
            imageUrl: body.imageUrl ?? null,
            price: body.price ?? null,
            data: body.data ?? null,
            status,
            source: body.source ? String(body.source) : "edit",
            label: body.label ? String(body.label) : null,
            basedOnVariationId:
              body.basedOnVariationId == null
                ? null
                : Number(body.basedOnVariationId),
            position,
            ...(isPublisher
              ? { reviewedAt: new Date(), reviewedBy: userId }
              : {}),
          })
          .returning();

        // A publisher may point the catalog at the variation in the same call.
        // Plans that already hold this item keep the version they pinned — the
        // pointer only decides what a NEW viewer or a NEW add sees.
        let item = parent;
        if (isPublisher && body.makeCurrent) {
          const [updatedItem] = await db
            .update(publicItems)
            .set({ currentVariationId: row.id })
            .where(eq(publicItems.id, itemId))
            .returning();
          item = updatedItem;
        }

        return json(201, { variation: row, item, publicItemId: itemId });
      }

      // Publisher decision on a suggested variation.
      if (resource === "variation-review") {
        if (body.variationId == null)
          return json(400, { error: "variationId is required" });
        const decision = String(body.decision || "");
        if (decision !== "approve" && decision !== "reject")
          return json(400, { error: "decision must be approve or reject" });

        const [variation] = await db
          .select()
          .from(itemVariations)
          .where(eq(itemVariations.id, Number(body.variationId)));
        if (!variation) return json(404, { error: "Not found" });

        const [parent] = await db
          .select()
          .from(publicItems)
          .where(eq(publicItems.id, variation.publicItemId));
        if (!parent) return json(404, { error: "Not found" });
        if (!(await userHasPublishPermissionForStore(parent.storeId, userId)))
          return json(403, { error: "Forbidden" });

        const approved = decision === "approve";
        const [updated] = await db
          .update(itemVariations)
          .set({
            status: approved ? "approved" : "rejected",
            reviewedAt: new Date(),
            reviewedBy: userId,
            reviewNote: body.reviewNote ? String(body.reviewNote) : null,
          })
          .where(eq(itemVariations.id, variation.id))
          .returning();

        let item = parent;
        if (approved && body.makeCurrent) {
          const [updatedItem] = await db
            .update(publicItems)
            .set({ currentVariationId: updated.id })
            .where(eq(publicItems.id, parent.id))
            .returning();
          item = updatedItem;
        } else if (!approved && parent.currentVariationId === variation.id) {
          // A rejected variation can no longer be what the catalog presents.
          const [updatedItem] = await db
            .update(publicItems)
            .set({ currentVariationId: null })
            .where(eq(publicItems.id, parent.id))
            .returning();
          item = updatedItem;
        }

        return json(200, { variation: updated, item });
      }

      // Publisher chooses which version the catalog presents. A null variationId
      // points back at the item's own base fields.
      if (resource === "current-variation") {
        if (body.publicItemId == null)
          return json(400, { error: "publicItemId is required" });

        const [parent] = await db
          .select()
          .from(publicItems)
          .where(eq(publicItems.id, Number(body.publicItemId)));
        if (!parent) return json(404, { error: "Not found" });
        if (!(await userHasPublishPermissionForStore(parent.storeId, userId)))
          return json(403, { error: "Forbidden" });

        let variationId: number | null = null;
        if (body.variationId != null) {
          const [variation] = await db
            .select()
            .from(itemVariations)
            .where(eq(itemVariations.id, Number(body.variationId)));
          if (!variation || variation.publicItemId !== parent.id)
            return json(404, { error: "Variation not found" });
          // Only an approved variation may be what everyone sees.
          if (variation.status !== "approved")
            return json(400, { error: "Approve the variation first" });
          variationId = variation.id;
        }

        const [item] = await db
          .update(publicItems)
          .set({ currentVariationId: variationId })
          .where(eq(publicItems.id, parent.id))
          .returning();

        return json(200, { item });
      }

      if (resource === "reactions") {
        if (!body.emoji) return json(400, { error: "emoji is required" });
        const emoji = String(body.emoji);

        // A reaction can target a comment (commentId) or an item/variation. For a
        // comment reaction we resolve the owning item from the comment itself, so
        // the caller only needs to pass commentId + emoji.
        const commentId =
          body.commentId == null ? null : Number(body.commentId);
        let itemId: number | null;
        let variationId: number | null;
        if (commentId != null) {
          const [parent] = await db
            .select()
            .from(comments)
            .where(eq(comments.id, commentId));
          if (!parent) return json(404, { error: "Comment not found" });
          itemId = parent.publicItemId;
          variationId = null;
        } else {
          itemId = await resolvePublicItemId(body, userId);
          if (itemId == null)
            return json(400, {
              error: "publicItemId or (catalogItemId + storeId) is required",
            });
          variationId = body.variationId == null ? null : Number(body.variationId);
        }

        // Toggle: remove this user's matching reaction if present, else add it.
        const existing = await db
          .select()
          .from(reactions)
          .where(
            and(
              eq(reactions.publicItemId, itemId),
              commentId == null
                ? isNull(reactions.commentId)
                : eq(reactions.commentId, commentId),
              variationId == null
                ? isNull(reactions.variationId)
                : eq(reactions.variationId, variationId),
              eq(reactions.userId, userId),
              eq(reactions.emoji, emoji),
            ),
          );

        if (existing.length > 0) {
          await db.delete(reactions).where(eq(reactions.id, existing[0].id));
          return json(200, {
            reacted: false,
            publicItemId: itemId,
            commentId,
          });
        }
        await db
          .insert(reactions)
          .values({ publicItemId: itemId, variationId, commentId, userId, emoji });
        return json(201, { reacted: true, publicItemId: itemId, commentId });
      }

      if (resource === "comments") {
        if (!body.body) return json(400, { error: "body is required" });

        // A reply carries parentCommentId; we resolve its owning item from the
        // parent so a reply only needs parentCommentId + body. A top-level comment
        // resolves the item the usual way (publicItemId or catalogItemId+storeId).
        const parentCommentId =
          body.parentCommentId == null ? null : Number(body.parentCommentId);
        let itemId: number | null;
        let variationId: number | null;
        if (parentCommentId != null) {
          const [parent] = await db
            .select()
            .from(comments)
            .where(eq(comments.id, parentCommentId));
          if (!parent) return json(404, { error: "Parent comment not found" });
          itemId = parent.publicItemId;
          variationId = parent.variationId;
        } else {
          itemId = await resolvePublicItemId(body, userId);
          if (itemId == null)
            return json(400, {
              error: "publicItemId or (catalogItemId + storeId) is required",
            });
          variationId = body.variationId == null ? null : Number(body.variationId);
        }

        const [row] = await db
          .insert(comments)
          .values({
            publicItemId: itemId,
            variationId,
            parentCommentId,
            userId,
            authorName: body.authorName ?? null,
            body: String(body.body),
          })
          .returning();
        return json(201, { comment: { ...row, reactions: {} } });
      }

      return json(404, { error: "Unknown resource" });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => null);
      if (!body || !body.id) return json(400, { error: "id is required" });
      const id = Number(body.id);

      // Authors may remove their own content.
      if (resource === "comments") {
        const [row] = await db.select().from(comments).where(eq(comments.id, id));
        if (!row) return json(404, { error: "Not found" });
        if (row.userId !== userId) return json(403, { error: "Forbidden" });
        await db.delete(comments).where(eq(comments.id, id));
        return json(200, { deleted: true });
      }
      if (resource === "variations") {
        const [row] = await db
          .select()
          .from(itemVariations)
          .where(eq(itemVariations.id, id));
        if (!row) return json(404, { error: "Not found" });
        if (row.authorId !== userId) return json(403, { error: "Forbidden" });
        await db.delete(itemVariations).where(eq(itemVariations.id, id));
        return json(200, { deleted: true });
      }
      if (resource === "items") {
        const [row] = await db
          .select()
          .from(publicItems)
          .where(eq(publicItems.id, id));
        if (!row) return json(404, { error: "Not found" });
        // The author may always remove their own idea; in addition, anyone with
        // publish permission on the owning store may remove it (moderation).
        const canModerate =
          row.authorId === userId ||
          (await userHasPublishPermissionForStore(row.storeId, userId));
        if (!canModerate) return json(403, { error: "Forbidden" });
        await db.delete(publicItems).where(eq(publicItems.id, id));
        return json(200, { deleted: true });
      }
      return json(404, { error: "Unknown resource" });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[public-catalog] error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: ["/api/public-catalog", "/api/public-catalog/*"],
};
