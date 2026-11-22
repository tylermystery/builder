// netlify/functions/collab-members.ts
//
// Store collab membership: two layers.
//   contributor — anyone signed in on the store. Reacts, comments, suggests ideas;
//                 their ideas wait for an admin to recommend them.
//   member      — approved by a store admin. Their ideas are recommended to the
//                 community straight away (admins can still flag them back).
// Store admins are the store's Airtable PublishPermission holders.
//
//   POST /api/collab/join     { storeId }                     signed in: become a contributor (idempotent)
//   GET  /api/collab/me?storeId=                              signed in: { status, isAdmin }
//   GET  /api/collab/members?storeId=                         admin: everyone, members and contributors
//   POST /api/collab/members  { storeId, userId, status }     admin: status 'member' | 'contributor'

import jwt from "jsonwebtoken";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { storeMembers } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const STORE_ID = /^rec[A-Za-z0-9]{10,20}$/;

function getUser(req: Request): { userId: string; name: string | null } | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ") || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET) as { userId?: string; name?: string };
    return decoded?.userId ? { userId: decoded.userId, name: decoded.name || null } : null;
  } catch {
    return null;
  }
}

const adminCache = new Map<string, { value: boolean; expiresAt: number }>();

// Same rule as public-catalog.ts: the store's PublishPermission list. Fails closed.
async function isStoreAdmin(storeId: string, userId: string): Promise<boolean> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId) return false;
  const key = `${storeId}:${userId}`;
  const cached = adminCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let allowed = false;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Stores/${encodeURIComponent(storeId)}`, {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { fields?: { PublishPermission?: unknown } };
      const list = data?.fields?.PublishPermission;
      allowed = Array.isArray(list) && list.includes(userId);
    }
  } catch {
    allowed = false;
  }
  adminCache.set(key, { value: allowed, expiresAt: Date.now() + 60_000 });
  return allowed;
}

async function findRow(storeId: string, userId: string) {
  const rows = await db
    .select()
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.userId, userId)));
  return rows[0] || null;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const resource = url.pathname.replace(/\/+$/, "").split("/").pop();
  const user = getUser(req);
  if (!user) return json(401, { error: "Sign in to collab" });

  if (req.method === "GET") {
    const storeId = url.searchParams.get("storeId") || "";
    if (!STORE_ID.test(storeId)) return json(400, { error: "A valid storeId is required" });
    const isAdmin = await isStoreAdmin(storeId, user.userId);

    if (resource === "me") {
      const row = await findRow(storeId, user.userId);
      return json(200, { status: isAdmin ? "admin" : row?.status || null, isAdmin });
    }
    if (resource === "members") {
      if (!isAdmin) return json(403, { error: "Store admins only" });
      const rows = await db
        .select()
        .from(storeMembers)
        .where(eq(storeMembers.storeId, storeId))
        .orderBy(desc(storeMembers.joinedAt));
      return json(200, { members: rows });
    }
    return json(404, { error: "Not found" });
  }

  if (req.method === "POST") {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const storeId = typeof body?.storeId === "string" ? body.storeId : "";
    if (!STORE_ID.test(storeId)) return json(400, { error: "A valid storeId is required" });

    if (resource === "join") {
      const existing = await findRow(storeId, user.userId);
      if (existing) {
        if (user.name && existing.userName !== user.name) {
          await db.update(storeMembers).set({ userName: user.name }).where(eq(storeMembers.id, existing.id));
        }
        return json(200, { status: existing.status });
      }
      try {
        await db.insert(storeMembers).values({ storeId, userId: user.userId, userName: user.name, status: "contributor" });
      } catch {
        // concurrent join: the unique index kept a single row
      }
      return json(201, { status: (await findRow(storeId, user.userId))?.status || "contributor" });
    }

    if (resource === "members") {
      if (!(await isStoreAdmin(storeId, user.userId))) return json(403, { error: "Store admins only" });
      const targetId = typeof body?.userId === "string" ? body.userId : "";
      const status = body?.status === "member" ? "member" : body?.status === "contributor" ? "contributor" : null;
      if (!targetId || !status) return json(400, { error: "userId and status ('member' or 'contributor') are required" });
      const existing = await findRow(storeId, targetId);
      const values = status === "member"
        ? { status, approvedAt: new Date(), approvedBy: user.userId }
        : { status, approvedAt: null, approvedBy: null };
      if (existing) {
        await db.update(storeMembers).set(values).where(eq(storeMembers.id, existing.id));
      } else {
        await db.insert(storeMembers).values({ storeId, userId: targetId, ...values });
      }
      return json(200, { member: await findRow(storeId, targetId) });
    }
  }

  return json(405, { error: "Method not allowed" });
};

export const config = {
  path: ["/api/collab/join", "/api/collab/me", "/api/collab/members"],
};
