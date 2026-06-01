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
//   POST   /api/public-catalog/variations   { publicItemId, name?, description?, imageUrl?, price?, data? }
//   POST   /api/public-catalog/reactions    { publicItemId | (catalogItemId + storeId) | commentId, variationId?, emoji }   (toggles)
//   POST   /api/public-catalog/comments     { publicItemId | (catalogItemId + storeId) | parentCommentId, variationId?, body, authorName? }
//
// For reactions/comments, passing a `catalogItemId` (+ `storeId`) instead of a
// `publicItemId` lazily creates a community container (source='catalog') for that
// existing curated catalog item on first interaction, so any catalog item can
// gather shared reactions and comments without pre-seeding the whole catalog.
//   DELETE /api/public-catalog/comments     { id }      (author removes own)
//   DELETE /api/public-catalog/variations   { id }      (author removes own)
//   DELETE /api/public-catalog/items         { id }      (author OR a store's publish-permission user removes it)

import jwt from "jsonwebtoken";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  publicItems,
  itemVariations,
  reactions,
  comments,
} from "../../db/schema.js";

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
async function userHasPublishPermissionForStore(
  storeId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId || !storeId || !userId) return false;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/Stores/${encodeURIComponent(storeId)}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { fields?: { PublishPermission?: unknown } };
    const allowed = data?.fields?.PublishPermission;
    return Array.isArray(allowed) && allowed.includes(userId);
  } catch {
    return false;
  }
}

// Assemble the full public catalog for a store: items with their variations,
// aggregated reaction counts (and the set of emoji each user picked), and the
// comment thread. Hidden rows are excluded.
async function getCatalog(storeId: string) {
  const items = await db
    .select()
    .from(publicItems)
    .where(and(eq(publicItems.storeId, storeId), eq(publicItems.hidden, false)));

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

  // Group children by their public item id.
  const byItem = (id: number) => ({
    variations: vars.filter((v) => v.publicItemId === id),
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
      return json(200, { items: await getCatalog(storeId) });
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

      if (resource === "variations") {
        if (!body.publicItemId)
          return json(400, { error: "publicItemId is required" });
        const [row] = await db
          .insert(itemVariations)
          .values({
            publicItemId: Number(body.publicItemId),
            authorId: userId,
            name: body.name ?? null,
            description: body.description ?? null,
            imageUrl: body.imageUrl ?? null,
            price: body.price ?? null,
            data: body.data ?? null,
          })
          .returning();
        return json(201, { variation: row });
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
