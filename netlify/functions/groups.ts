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
//   POST   /api/groups/create-member          (auth + publish permission)  create user + add member
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
type UserLite = {
  id: string;
  name: string;
  imageUrl: string | null;
  email?: string;
  bio?: string;
  storeName?: string;
  linkedToStore?: boolean;
  matchedByEmail?: boolean;
};

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
    email: typeof f.Email === "string" ? f.Email : undefined,
    bio: typeof f.Bio === "string" ? f.Bio : undefined,
    storeName: typeof f["Store Name"] === "string" ? f["Store Name"] : undefined,
  };
}

function cleanEmail(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function airtableStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function fetchUserByEmail(email: string): Promise<UserLite | null> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  const clean = cleanEmail(email);
  if (!pat || !baseId || !clean) return null;
  const formula = `LOWER({Email})='${airtableStringLiteral(clean)}'`;
  const url =
    `https://api.airtable.com/v0/${baseId}/Users` +
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&fields%5B%5D=Name&fields%5B%5D=ProfilePicture&fields%5B%5D=Email&pageSize=1`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }> };
    const rec = data.records?.[0];
    return rec ? { ...shapeUser(rec), matchedByEmail: true } : null;
  } catch {
    return null;
  }
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

function cleanPhotoUrls(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  return raw
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 6);
}

function cleanHttpUrl(value: unknown): string | null {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

type CreateMemberFailure = {
  error: string;
  debug: {
    stage: string;
    status?: number;
    airtableType?: string;
    airtableMessage?: string;
    attemptedFields?: string[];
  };
};

async function readAirtableError(res: Response): Promise<{ type?: string; message?: string }> {
  try {
    const data = (await res.json()) as { error?: { type?: string; message?: string } | string };
    if (typeof data.error === "string") return { message: data.error };
    return {
      type: data.error?.type,
      message: data.error?.message,
    };
  } catch {
    return {};
  }
}

async function createAirtableUserForGroup(
  body: Record<string, unknown>,
  storeId: string,
): Promise<UserLite | CreateMemberFailure> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId) {
    return { error: "Airtable is not configured", debug: { stage: "config" } };
  }

  const name = String(body.name || "").trim();
  if (!name) return { error: "name is required", debug: { stage: "validation" } };

  const baseFields: Record<string, unknown> = {
    Name: name,
  };
  const email = cleanEmail(body.email ?? body.memberEmail);
  if (email) baseFields.Email = email;
  const optionalFields: Array<[string, unknown]> = [["Stores", [storeId]]];
  const photoUrls = cleanPhotoUrls(body.photoUrls ?? body.imageUrls ?? body.profilePhotos);
  if (photoUrls.length) optionalFields.push(["ProfilePicture", photoUrls.map((url) => ({ url }))]);
  const bio = String(body.bio || "").trim();
  if (bio) optionalFields.push(["Bio", bio]);
  const storeName = String(body.storeName || "").trim();
  if (storeName) optionalFields.push(["Store Name", storeName]);

  const url = `https://api.airtable.com/v0/${baseId}/Users`;
  for (let keep = optionalFields.length; keep >= 0; keep--) {
    const fields = { ...baseFields };
    for (const [key, value] of optionalFields.slice(0, keep)) fields[key] = value;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] }),
    });
    if (res.ok) {
      const data = (await res.json()) as { records?: Array<{ id: string; fields?: Record<string, unknown> }> };
      const rec = data.records?.[0];
      return rec ? { ...shapeUser(rec), linkedToStore: "Stores" in fields } : {
        error: "Could not create member",
        debug: { stage: "airtable-empty-response", attemptedFields: Object.keys(fields) },
      };
    }
    // Retry by dropping optional fields if Airtable rejects a field that this
    // base does not have. If the Stores link field itself is unavailable, a
    // minimal Airtable user is still enough because the group member card lives
    // in Postgres and is anchored to the group there.
    if (keep === 0 || res.status !== 422) {
      const airtableError = await readAirtableError(res);
      return {
        error: "Could not create member",
        debug: {
          stage: "airtable-create-user",
          status: res.status,
          airtableType: airtableError.type,
          airtableMessage: airtableError.message,
          attemptedFields: Object.keys(fields),
        },
      };
    }
  }
  return { error: "Could not create member", debug: { stage: "airtable-create-user" } };
}

function buildMemberValues(body: Record<string, unknown>) {
  const photoUrls = cleanPhotoUrls(body.photoUrls ?? body.imageUrls ?? body.profilePhotos);
  return {
    role: String(body.role ?? "member") === "admin" ? "admin" : "member",
    displayName: String(body.name || body.displayName || "").trim() || null,
    bio: String(body.bio || "").trim() || null,
    imageUrls: photoUrls.length ? photoUrls : null,
    memberEmail: cleanEmail(body.email ?? body.memberEmail),
    storeName: String(body.storeName || "").trim() || null,
    storeUrl: cleanHttpUrl(body.storeUrl),
  };
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
      const isGroupAdmin = !!userId && memberRows.some((m) => m.userId === userId && m.role === "admin");
      const canManageMembers = canManage || isGroupAdmin;

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
          const imageUrls = Array.isArray(m.imageUrls) ? m.imageUrls.filter((url): url is string => typeof url === "string") : [];
          const canEdit = canManageMembers || (!!userId && m.userId === userId);
          return {
            userId: m.userId,
            role: m.role,
            joinedAt: m.joinedAt,
            name: m.displayName || u?.name || "Member",
            imageUrl: imageUrls[0] || u?.imageUrl || null,
            imageUrls,
            bio: m.bio || u?.bio || "",
            email: canEdit ? m.memberEmail || "" : "",
            storeName: m.storeName || u?.storeName || "",
            storeUrl: m.storeUrl || "",
            canEdit,
          };
        })
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          return new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime();
        });

      return json(200, {
        canManage,
        canManageMembers,
        currentUserId: userId,
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

    // ---- Create a lightweight Airtable user and add them ------------------
    if (req.method === "POST" && resource === "create-member") {
      const groupId = body.groupId == null ? null : Number(body.groupId);
      if (!groupId) return json(400, { error: "groupId is required" });
      const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
      if (!g) return json(404, { error: "Group not found" });
      if (!(await userHasPublishPermissionForStore(g.storeId, userId)))
        return json(403, { error: "Forbidden" });

      const matched = cleanEmail(body.email ?? body.memberEmail)
        ? await fetchUserByEmail(String(body.email ?? body.memberEmail))
        : null;
      const created = matched || (await createAirtableUserForGroup(body, g.storeId));
      if ("error" in created) return json(400, created);
      const values = buildMemberValues(body);
      await db
        .insert(groupMembers)
        .values({
          groupId,
          userId: created.id,
          ...values,
          displayName: values.displayName || created.name,
          memberEmail: values.memberEmail || created.email || null,
        })
        .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] });
      return json(201, {
        member: created,
        debug: { linkedToStore: !!created.linkedToStore, matchedByEmail: !!created.matchedByEmail },
      });
    }

    // ---- Membership changes ---------------------------------------------
    if (resource === "members") {
      const groupId = body.groupId == null ? null : Number(body.groupId);
      const memberId = body.userId ? String(body.userId) : "";
      if (!groupId || !memberId) return json(400, { error: "groupId and userId are required" });
      const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
      if (!g) return json(404, { error: "Group not found" });
      const memberRows = await db
        .select()
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId));
      const canPublish = await userHasPublishPermissionForStore(g.storeId, userId);
      const isGroupAdmin = memberRows.some((m) => m.userId === userId && m.role === "admin");
      const isSelf = memberId === userId;
      if (!canPublish && !isGroupAdmin && !(isSelf && req.method !== "POST"))
        return json(403, { error: "Forbidden" });

      if (req.method === "POST") {
        if (!canPublish) return json(403, { error: "Forbidden" });
        const values = buildMemberValues(body);
        // Idempotent add: ignore a duplicate (group,user) so re-adds are safe.
        await db
          .insert(groupMembers)
          .values({
            groupId,
            userId: memberId,
            ...values,
          })
          .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] });
        return json(201, { added: true });
      }
      if (req.method === "PATCH") {
        const existing = memberRows.find((m) => m.userId === memberId);
        if (!existing) return json(404, { error: "Member not found" });
        const values = buildMemberValues(body);
        if (!canPublish && !isGroupAdmin) values.role = existing.role;
        const [member] = await db
          .update(groupMembers)
          .set(values)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId)))
          .returning();
        return json(200, { member });
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
