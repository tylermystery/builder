// netlify/functions/plan-history.ts
//
// Plan History (read-only timeline in the conversation panel).
//
//   GET  /api/plan-history?sessionId=<airtablePlanId>[&limit=100]
//          Newest first. Readable by anyone who has the plan link, like the plan itself.
//
//   POST /api/plan-history   (signed-in users only; Bearer JWT)
//          { sessionId, userName, changes: [{ type, text, itemId? }], merged }
//          Records one save's changes. The author comes from the token, never the body.

import jwt from "jsonwebtoken";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { planHistory } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const SESSION_ID = /^rec[A-Za-z0-9]{10,20}$/;
const MAX_CHANGES = 50;
const MAX_TEXT = 200;
const TYPES = new Set(["item", "status", "details", "chat", "order", "group", "task"]);

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

function cleanChanges(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_CHANGES)
    .map((c) => {
      const change = (c || {}) as Record<string, unknown>;
      const text = typeof change.text === "string" ? change.text.trim().slice(0, MAX_TEXT) : "";
      if (!text) return null;
      const type = typeof change.type === "string" && TYPES.has(change.type) ? change.type : "item";
      const itemId = typeof change.itemId === "string" ? change.itemId.slice(0, 120) : undefined;
      return itemId ? { type, text, itemId } : { type, text };
    })
    .filter(Boolean);
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") || "";
    if (!SESSION_ID.test(sessionId)) return json(400, { error: "A valid sessionId is required" });
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 300);
    const rows = await db
      .select()
      .from(planHistory)
      .where(eq(planHistory.sessionId, sessionId))
      .orderBy(desc(planHistory.createdAt), desc(planHistory.id))
      .limit(limit);
    return json(200, {
      entries: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        changes: r.changes,
        merged: r.merged,
        createdAt: r.createdAt,
      })),
    });
  }

  if (req.method === "POST") {
    const userId = getUserId(req);
    if (!userId) return json(401, { error: "Sign in to record plan changes" });
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!SESSION_ID.test(sessionId)) return json(400, { error: "A valid sessionId is required" });
    const changes = cleanChanges(body.changes);
    if (changes.length === 0) return json(400, { error: "No changes to record" });
    const userName = typeof body.userName === "string" ? body.userName.trim().slice(0, 80) || null : null;
    const [row] = await db
      .insert(planHistory)
      .values({ sessionId, userId, userName, changes, merged: body.merged === true })
      .returning({ id: planHistory.id, createdAt: planHistory.createdAt });
    return json(201, row);
  }

  return json(405, { error: "Method not allowed" });
};

export const config = {
  path: "/api/plan-history",
};
