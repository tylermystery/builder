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
//   POST   /api/public-catalog/reactions    { publicItemId, variationId?, emoji }   (toggles)
//   POST   /api/public-catalog/comments     { publicItemId, variationId?, body, authorName? }
//   DELETE /api/public-catalog/comments     { id }      (author removes own)
//   DELETE /api/public-catalog/variations   { id }      (author removes own)
//   DELETE /api/public-catalog/items        { id }      (author removes own)

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
  // optionally scoped to a variation (variationId === null => item-level).
  const summariseReactions = (
    rows: typeof reacts,
    variationId: number | null,
  ) => {
    const scoped = rows.filter((r) =>
      variationId === null ? r.variationId == null : r.variationId === variationId,
    );
    const counts: Record<string, { count: number; users: string[] }> = {};
    for (const r of scoped) {
      if (!counts[r.emoji]) counts[r.emoji] = { count: 0, users: [] };
      counts[r.emoji].count += 1;
      counts[r.emoji].users.push(r.userId);
    }
    return counts;
  };

  return items.map((item) => {
    const { variations, reactions: r, comments: c } = byItem(item.id);
    return {
      ...item,
      reactions: summariseReactions(r, null),
      comments: c.filter((x) => x.variationId == null),
      variations: variations.map((v) => ({
        ...v,
        reactions: summariseReactions(r, v.id),
        comments: c.filter((x) => x.variationId === v.id),
      })),
    };
  });
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
        if (!body.publicItemId || !body.emoji)
          return json(400, { error: "publicItemId and emoji are required" });
        const itemId = Number(body.publicItemId);
        const variationId =
          body.variationId == null ? null : Number(body.variationId);
        const emoji = String(body.emoji);

        // Toggle: remove this user's matching reaction if present, else add it.
        const existing = await db
          .select()
          .from(reactions)
          .where(
            and(
              eq(reactions.publicItemId, itemId),
              variationId == null
                ? isNull(reactions.variationId)
                : eq(reactions.variationId, variationId),
              eq(reactions.userId, userId),
              eq(reactions.emoji, emoji),
            ),
          );

        if (existing.length > 0) {
          await db.delete(reactions).where(eq(reactions.id, existing[0].id));
          return json(200, { reacted: false });
        }
        await db
          .insert(reactions)
          .values({ publicItemId: itemId, variationId, userId, emoji });
        return json(201, { reacted: true });
      }

      if (resource === "comments") {
        if (!body.publicItemId || !body.body)
          return json(400, { error: "publicItemId and body are required" });
        const [row] = await db
          .insert(comments)
          .values({
            publicItemId: Number(body.publicItemId),
            variationId:
              body.variationId == null ? null : Number(body.variationId),
            userId,
            authorName: body.authorName ?? null,
            body: String(body.body),
          })
          .returning();
        return json(201, { comment: row });
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
        if (row.authorId !== userId) return json(403, { error: "Forbidden" });
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
