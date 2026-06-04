// netlify/functions/event-rsvp.ts
//
// Party-size companion to event RSVPs. The yes / maybe / no MEMBERSHIP of an
// event RSVP still lives in Airtable (the event record's RSVPs / RSVPMaybe /
// RSVPNo fields, written by the existing client flow). This endpoint stores only
// the PARTY SIZE — the "number of RSVPs" a single guest reserves — in Postgres
// (see the event_rsvps table in db/schema.ts), so a guest can RSVP for more than
// one spot. It is purely additive: nothing here changes who is going, only how
// many spots each responder holds.
//
// Routes (all under /api/event-rsvp):
//
//   GET    /api/event-rsvp?eventId=<airtableEventId>
//            Public read. Returns a { userId: partySize } map for every guest who
//            has a stored party size, and — when a valid token is presented — the
//            caller's own saved party size + response under `mine`. Headcount
//            totals are intentionally computed on the client against the
//            authoritative Airtable RSVP membership, so guests who responded
//            before this feature (no row here) are correctly counted as one spot.
//
//   POST   /api/event-rsvp            (auth)  upsert the caller's party size
//            body: { eventId, rsvpType: 'yes'|'maybe'|'no', quantity: >=1 }
//
//   DELETE /api/event-rsvp            (auth)  remove the caller's party-size row
//            body: { eventId }   (used when a guest clears their RSVP)
//
// Auth mirrors groups.ts / promotions.ts: a Bearer JWT whose `userId` claim is
// the Airtable user record id. The guest is always taken from the verified
// token, never from the request body, so one guest can never write another's row.

import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { eventRsvps } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

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

const VALID_TYPES = new Set(["yes", "maybe", "no"]);

export default async (req: Request) => {
  try {
    const url = new URL(req.url);

    // ---- Public read: party-size map (+ caller's own row when authed) ----
    if (req.method === "GET") {
      const eventId = url.searchParams.get("eventId");
      if (!eventId) return json(400, { error: "eventId is required" });

      const rows = await db
        .select()
        .from(eventRsvps)
        .where(eq(eventRsvps.eventId, eventId));

      // Map of guest -> party size. The client folds this over the authoritative
      // Airtable RSVP lists so legacy responders (absent here) count as one spot.
      const quantities: Record<string, number> = {};
      for (const r of rows) quantities[r.userId] = r.quantity;

      let mine: { quantity: number; rsvpType: string } | null = null;
      const userId = getUserId(req);
      if (userId) {
        const row = rows.find((r) => r.userId === userId);
        if (row) mine = { quantity: row.quantity, rsvpType: row.rsvpType };
      }
      return json(200, { quantities, mine });
    }

    // ---- Everything below requires auth ----------------------------------
    const userId = getUserId(req);
    if (!userId) return json(401, { error: "Login required" });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "Invalid JSON body" });
    const eventId = body.eventId ? String(body.eventId) : "";
    if (!eventId) return json(400, { error: "eventId is required" });

    if (req.method === "POST") {
      const rsvpType = String(body.rsvpType ?? "yes");
      if (!VALID_TYPES.has(rsvpType))
        return json(400, { error: "rsvpType must be 'yes', 'maybe', or 'no'" });
      // Clamp to a sane party size; default to 1 spot.
      let quantity = Math.floor(Number(body.quantity));
      if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
      if (quantity > 999) quantity = 999;

      const [row] = await db
        .insert(eventRsvps)
        .values({ eventId, userId, rsvpType, quantity })
        .onConflictDoUpdate({
          target: [eventRsvps.eventId, eventRsvps.userId],
          set: { rsvpType, quantity, updatedAt: new Date() },
        })
        .returning();

      return json(200, { saved: true, mine: { quantity: row.quantity, rsvpType: row.rsvpType } });
    }

    if (req.method === "DELETE") {
      await db
        .delete(eventRsvps)
        .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)));
      return json(200, { removed: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[event-rsvp] error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: ["/api/event-rsvp", "/api/event-rsvp/*"],
};
