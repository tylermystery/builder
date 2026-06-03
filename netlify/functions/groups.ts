// netlify/functions/groups.ts
//
// Member-groups API. A group is a store-owned, named collection of people (for
// example a "Membership" group under the "Union Machine Works" store). The
// definition lives in Postgres (see db/schema.ts); the owning store and every
// member are Airtable record ids stored as text.
//
// Routes (all under /api/groups):
//
//   GET    /api/groups?storeId=<airtableStoreId>
//            Directory read. Always returns the store's PUBLIC groups (each with
//            a live member count). If the caller presents a valid token that
//            holds publish permission for the store, PRIVATE groups are included
//            too and `canManage` is true — this single endpoint powers the
//            directory for both visitors and publishers.
//
//   GET    /api/groups/by-slug?slug=<slug>
//            One group plus its roster (members resolved to name + picture).
//            Public groups are readable by anyone. Private groups require a
//            token belonging to a store publisher or to one of the group's own
//            members; everyone else gets 403 { private: true }.
//
//   GET    /api/groups/store-users?storeId=   (auth + publish permission)
//            The store's people (id, name, picture) — the roster the management
//            UI picks members from.
//
//   POST   /api/groups                        (auth + publish permission)  create
//   PATCH  /api/groups                        (auth + publish permission)  edit
//   DELETE /api/groups                        (auth + publish permission)  delete
//   POST   /api/groups/members                (auth + publish permission)  add member
//   DELETE /api/groups/members                (auth + publish permission)  remove member
//
// Permissioning mirrors promotions.ts exactly: the store's PublishPermission
// holders are the only people who may create/edit a group or change its
// membership.

import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { groups, groupMembers } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------------------
// Auth helpers (mirror promotions.ts / public-catalog.ts exactly).
// ---------------------------------------------------------------------------
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

// True when the Airtable store record lists `userId` in its PublishPermission
// field — the same gate promotions.ts uses. Fails closed.
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

// ---------------------------------------------------------------------------
// Airtable user lookups (for rendering rosters and the member picker).
// ---------------------------------------------------------------------------
type UserLite = { id: string; name: string; imageUrl: string | null };

// Only ever embed Airtable record ids that match the expected shape into a
// formula, so a hostile value can never break out of the formula string.
const isRecId = (s: unknown): s is string => typeof s === "string" && /^[a-zA-Z0-9]+$/.test(s);

function shapeUser(rec: { id: string; fields?: Record<string, unknown> }): UserLite {
  const f = rec.fields || {};
  const pic = f.ProfilePicture as Array<{ url?: string }> | undefined;
  return {
    id: rec.id,
    name: (f.Name as string) || "Member",
    imageUrl: (Array.isArray(pic) && pic[0]?.url) || null,
  };
}

// Resolve a set of Airtable user ids to {id, name, imageUrl}. Batched to keep
// formulas short. Missing/inaccessible ids are simply omitted from the map.
async function fetchUsersByIds(ids: string[]): Promise<Map<string, UserLite>> {
  const out = new Map<string, UserLite>();
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  const clean = [...new Set(ids.filter(isRecId))];
  if (!pat || !baseId || clean.length === 0) return out;

  for (let i = 0; i < clean.length; i += 50) {
    const chunk = clean.slice(i, i + 50);
    const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
    const url =
      `https://api.airtable.com/v0/${baseId}/Users` +
      `?filterByFormula=${encodeURIComponent(formula)}` +
      `&fields%5B%5D=Name&fields%5B%5D=ProfilePicture`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
      if (!res.ok) continue;
      const data = (await res.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }> };
      for (const rec of data.records || []) out.set(rec.id, shapeUser(rec));
    } catch {
      /* skip this chunk on error */
    }
  }
  return out;
}

// Every Airtable user linked to a store (their Stores field contains it).
async function fetchStoreUsers(storeId: string): Promise<UserLite[]> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId || !isRecId(storeId)) return [];
  const formula = `FIND('${storeId}', ARRAYJOIN({Stores}))`;
  const url =
    `https://api.airtable.com/v0/${baseId}/Users` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&fields%5B%5D=Name&fields%5B%5D=ProfilePicture&pageSize=100`;
  const users: UserLite[] = [];
  try {
    let offset: string | undefined;
    do {
      const res = await fetch(offset ? `${url}&offset=${offset}` : url, {
        headers: { Authorization: `Bearer ${pat}` },
      });
      if (!res.ok) break;
      const data = (await res.json()) as {
        records?: Array<{ id: string; fields?: Record<string, unknown> }>;
        offset?: string;
      };
      for (const rec of data.records || []) users.push(shapeUser(rec));
      offset = data.offset;
    } while (offset);
  } catch {
    /* return whatever we gathered */
  }
  return users;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
type GroupRow = typeof groups.$inferSelect;

const slugify = (s: string) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "group";

// A readable, globally-unique slug: the name slug plus a short random suffix,
// retried on the (vanishingly unlikely) collision against the unique index.
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base}-${randomBytes(3).toString("hex")}`;
    const [hit] = await db.select({ id: groups.id }).from(groups).where(eq(groups.slug, candidate));
    if (!hit) return candidate;
  }
  // Fall back to something guaranteed-unique-ish.
  return `${base}-${randomBytes(6).toString("hex")}`;
}

// member counts for a set of groups: groupId -> count
async function memberCounts(ids: number[]): Promise<Record<number, number>> {
  const map: Record<number, number> = {};
  for (const id of ids) map[id] = 0;
  if (ids.length === 0) return map;
  const rows = await db
    .select({ groupId: groupMembers.groupId, c: sql<number>`count(*)::int` })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, ids))
    .groupBy(groupMembers.groupId);
  for (const r of rows) map[r.groupId] = Number(r.c);
  return map;
}

function publicShape(g: GroupRow, count: number) {
  return {
    id: g.id,
    storeId: g.storeId,
    name: g.name,
    description: g.description,
    kind: g.kind,
    imageUrl: g.imageUrl,
    slug: g.slug,
    visibility: g.visibility,
    memberCount: count,
    createdAt: g.createdAt,
  };
}

// Coerce/validate an incoming group definition (create/patch). Returns the
// column values or a string error message.
function buildGroupValues(body: Record<string, unknown>, partial: boolean) {
  const v: Record<string, unknown> = {};
  const want = (k: string) => body[k] !== undefined;

  if (!partial || want("name")) {
    const name = String(body.name ?? "").trim();
    if (!name) return "name is required";
    v.name = name;
  }
  if (want("description")) v.description = String(body.description ?? "");
  if (want("kind")) {
    const kind = body.kind == null ? null : String(body.kind).trim();
    v.kind = kind || null;
  }
  if (want("imageUrl")) {
    const img = body.imageUrl == null ? null : String(body.imageUrl).trim();
    v.imageUrl = img || null;
  }
  if (!partial || want("visibility")) {
    const vis = String(body.visibility ?? "public");
    if (vis !== "public" && vis !== "private")
      return "visibility must be 'public' or 'private'";
    v.visibility = vis;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async (req: Request) => {
  const url = new URL(req.url);
  const resource = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    // ---- Public directory read ------------------------------------------
    if (req.method === "GET" && resource !== "by-slug" && resource !== "store-users") {
      const storeId = url.searchParams.get("storeId");
      if (!storeId) return json(400, { error: "storeId is required" });

      // A publisher viewing the directory also sees private groups.
      const userId = getUserId(req);
      const canManage = userId
        ? await userHasPublishPermissionForStore(storeId, userId)
        : false;

      const rows = await db.select().from(groups).where(eq(groups.storeId, storeId));
      const visible = canManage ? rows : rows.filter((g) => g.visibility === "public");
      const counts = await memberCounts(visible.map((g) => g.id));
      return json(200, {
        canManage,
        groups: visible.map((g) => publicShape(g, counts[g.id] ?? 0)),
      });
    }

    // ---- Single group + roster (visibility enforced) --------------------
    if (req.method === "GET" && resource === "by-slug") {
      const slug = url.searchParams.get("slug");
      if (!slug) return json(400, { error: "slug is required" });
      const [g] = await db.select().from(groups).where(eq(groups.slug, slug));
      if (!g) return json(404, { error: "Group not found" });

      const userId = getUserId(req);
      const canManage = userId
        ? await userHasPublishPermissionForStore(g.storeId, userId)
        : false;

      const memberRows = await db
        .select()
        .from(groupMembers)
        .where(eq(groupMembers.groupId, g.id));

      if (g.visibility === "private" && !canManage) {
        const isMember = !!userId && memberRows.some((m) => m.userId === userId);
        if (!isMember)
          return json(403, { error: "This group is private", private: true });
      }

      // Resolve roster display info, admins first then by join time.
      const userMap = await fetchUsersByIds(memberRows.map((m) => m.userId));
      const roster = memberRows
        .map((m) => {
          const u = userMap.get(m.userId);
          return {
            userId: m.userId,
            role: m.role,
            joinedAt: m.joinedAt,
            name: u?.name || "Member",
            imageUrl: u?.imageUrl || null,
          };
        })
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          return new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime();
        });

      return json(200, {
        canManage,
        group: { ...publicShape(g, roster.length) },
        members: roster,
      });
    }

    // ---- Everything below requires auth ---------------------------------
    const userId = getUserId(req);
    if (!userId) return json(401, { error: "Login required" });

    // Store's people for the member picker.
    if (req.method === "GET" && resource === "store-users") {
      const storeId = url.searchParams.get("storeId");
      if (!storeId) return json(400, { error: "storeId is required" });
      if (!(await userHasPublishPermissionForStore(storeId, userId)))
        return json(403, { error: "Forbidden" });
      return json(200, { users: await fetchStoreUsers(storeId) });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "Invalid JSON body" });

    // ---- Membership changes ---------------------------------------------
    if (resource === "members") {
      const groupId = body.groupId == null ? null : Number(body.groupId);
      const memberId = body.userId ? String(body.userId) : "";
      if (!groupId || !memberId) return json(400, { error: "groupId and userId are required" });
      const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
      if (!g) return json(404, { error: "Group not found" });
      if (!(await userHasPublishPermissionForStore(g.storeId, userId)))
        return json(403, { error: "Forbidden" });

      if (req.method === "POST") {
        const role = String(body.role ?? "member") === "admin" ? "admin" : "member";
        // Idempotent add: ignore a duplicate (group,user) so re-adds are safe.
        await db
          .insert(groupMembers)
          .values({ groupId, userId: memberId, role })
          .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] });
        return json(201, { added: true });
      }
      if (req.method === "DELETE") {
        await db
          .delete(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId)));
        return json(200, { removed: true });
      }
      return json(405, { error: "Method not allowed" });
    }

    // ---- Group create / edit / delete -----------------------------------
    if (req.method === "POST") {
      const storeId = body.storeId ? String(body.storeId) : "";
      if (!storeId) return json(400, { error: "storeId is required" });
      if (!(await userHasPublishPermissionForStore(storeId, userId)))
        return json(403, { error: "Forbidden" });
      const values = buildGroupValues(body, false);
      if (typeof values === "string") return json(400, { error: values });
      const slug = await uniqueSlug(String((values as { name: string }).name));
      const [row] = await db
        .insert(groups)
        .values({ ...(values as object), storeId, slug, createdBy: userId } as typeof groups.$inferInsert)
        .returning();
      return json(201, { group: row });
    }

    if (req.method === "PATCH") {
      const id = body.id == null ? null : Number(body.id);
      if (!id) return json(400, { error: "id is required" });
      const [existing] = await db.select().from(groups).where(eq(groups.id, id));
      if (!existing) return json(404, { error: "Not found" });
      if (!(await userHasPublishPermissionForStore(existing.storeId, userId)))
        return json(403, { error: "Forbidden" });
      const values = buildGroupValues(body, true);
      if (typeof values === "string") return json(400, { error: values });
      if (Object.keys(values).length === 0) return json(400, { error: "No fields to update" });
      const [row] = await db
        .update(groups)
        .set(values as Partial<typeof groups.$inferInsert>)
        .where(eq(groups.id, id))
        .returning();
      return json(200, { group: row });
    }

    if (req.method === "DELETE") {
      const id = body.id == null ? null : Number(body.id);
      if (!id) return json(400, { error: "id is required" });
      const [existing] = await db.select().from(groups).where(eq(groups.id, id));
      if (!existing) return json(404, { error: "Not found" });
      if (!(await userHasPublishPermissionForStore(existing.storeId, userId)))
        return json(403, { error: "Forbidden" });
      await db.delete(groups).where(eq(groups.id, id));
      return json(200, { deleted: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[groups] error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: ["/api/groups", "/api/groups/*"],
};
