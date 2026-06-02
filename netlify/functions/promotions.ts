// netlify/functions/promotions.ts
//
// Promotions API + the authoritative pricing engine.
//
// This single function owns everything about a deal's *definition and math*:
//
//   GET    /api/promotions?storeId=<airtableStoreId>
//            Public. Active, still-available promotions for a store, each with a
//            live `remaining` count. The browser uses this to draw badges,
//            struck-through prices, "N left" and countdowns.
//
//   POST   /api/promotions/quote   { storeId, cart:[line], sessionId? }
//            Public. Given a cart, returns the single best-for-the-customer
//            promotion that applies (deals are one-at-a-time), the total
//            discount in cents, and a short-lived signed token. Checkout sends
//            that token to create-payment-intent so the discount the customer is
//            charged is the one this server computed — never a number the
//            browser invented.
//
//   GET    /api/promotions/manage?storeId=   (auth + publish permission)
//            Every promotion for the store, active or not, with redemption
//            counts — the authoring/admin view.
//   POST   /api/promotions                   (auth + publish permission)  create
//   PATCH  /api/promotions                   (auth + publish permission)  edit
//   DELETE /api/promotions                   (auth + publish permission)  remove
//
// The redemption *counter* (the "three then gone" guarantee) is enforced
// transactionally from the payment-confirmation path, not here — see
// netlify/functions/utils/promotions-redeem.js.

import jwt from "jsonwebtoken";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { promotions, promotionRedemptions } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

// ---------------------------------------------------------------------------
// Auth helpers (mirror public-catalog.ts exactly).
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
// field — the same gate public-catalog.ts uses. Fails closed.
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
// The pricing engine (pure — no DB, no clock beyond the `now` passed in).
// ---------------------------------------------------------------------------
type PromoRow = typeof promotions.$inferSelect;
type RemainingMap = Record<number, number | null>; // promoId -> remaining (null = unlimited)

interface CartLine {
  itemId?: string;
  storeId?: string;
  categories?: string[];
  unitPriceCents: number;
  quantity: number;
  eventDate?: string | null; // ISO; only meaningful for rolling deals
}

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const DAY_MS = 24 * 60 * 60 * 1000;

// Is the deal's date gate open for this line right now?
function dateEligible(p: PromoRow, line: CartLine, now: Date): boolean {
  if (p.eligibilityMode === "rolling") {
    // True last-minute behaviour: eligible only while the booked event falls
    // within window_days ahead of now (and is not already in the past).
    if (!p.windowDays || !line.eventDate) return false;
    const event = new Date(line.eventDate).getTime();
    if (Number.isNaN(event)) return false;
    const daysOut = (event - now.getTime()) / DAY_MS;
    return daysOut >= -0.5 && daysOut <= p.windowDays;
  }
  // fixed_end: live between optional start and the shared deadline.
  if (p.startsAt && now < new Date(p.startsAt)) return false;
  if (p.endsAt && now > new Date(p.endsAt)) return false;
  return true;
}

// Does this line fall inside the deal's scope? Item/category/store deals are all
// store-owned, so store ownership is required for store- and category-scope.
function scopeMatch(p: PromoRow, line: CartLine): boolean {
  if (p.scopeType === "item") return !!line.itemId && line.itemId === p.target;
  if (p.scopeType === "store") return line.storeId === p.storeId;
  if (p.scopeType === "category") {
    if (line.storeId !== p.storeId) return false;
    const labels = (line.categories || []).map(norm);
    return labels.includes(norm(p.target));
  }
  return false;
}

// Discount in cents this deal would take off one whole line (unit × qty).
function lineDiscountCents(p: PromoRow, line: CartLine): number {
  const base = Math.max(0, Math.round(line.unitPriceCents * (line.quantity || 1)));
  if (base <= 0) return 0;
  if (p.rewardType === "amount") return Math.min(p.rewardValue, base);
  // percent
  const pct = Math.max(0, Math.min(100, p.rewardValue));
  return Math.min(base, Math.round((base * pct) / 100));
}

// Pick the single promotion that leaves the customer paying least across the
// whole cart (deals are one-at-a-time, but the chosen one discounts EVERY
// matching line). Sold-out and inactive deals are excluded by the caller via
// `remaining`.
function bestPromotionForCart(
  promos: PromoRow[],
  lines: CartLine[],
  remaining: RemainingMap,
  now: Date,
) {
  let best: {
    promotion: PromoRow;
    discountCents: number;
    perLine: { index: number; itemId?: string; discountCents: number }[];
  } | null = null;

  for (const p of promos) {
    if (!p.active) continue;
    const rem = remaining[p.id];
    if (rem !== null && rem !== undefined && rem <= 0) continue;

    const perLine: { index: number; itemId?: string; discountCents: number }[] = [];
    let total = 0;
    lines.forEach((line, index) => {
      if (!scopeMatch(p, line) || !dateEligible(p, line, now)) return;
      const d = lineDiscountCents(p, line);
      if (d > 0) {
        perLine.push({ index, itemId: line.itemId, discountCents: d });
        total += d;
      }
    });

    if (total > 0 && (!best || total > best.discountCents)) {
      best = { promotion: p, discountCents: total, perLine };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
async function remainingFor(promos: PromoRow[]): Promise<RemainingMap> {
  const map: RemainingMap = {};
  for (const p of promos) map[p.id] = p.maxRedemptions ?? null;
  const ids = promos.map((p) => p.id);
  if (ids.length === 0) return map;
  const counts = await db
    .select({
      promotionId: promotionRedemptions.promotionId,
      c: sql<number>`count(*)::int`,
    })
    .from(promotionRedemptions)
    .where(inArray(promotionRedemptions.promotionId, ids))
    .groupBy(promotionRedemptions.promotionId);
  for (const row of counts) {
    const max = map[row.promotionId];
    if (max !== null && max !== undefined) {
      map[row.promotionId] = Math.max(0, max - Number(row.c));
    }
  }
  return map;
}

// Shape a promotion for public consumption (display). No secrets to strip; this
// just keeps the wire format stable and adds the live remaining count.
function publicShape(p: PromoRow, remaining: number | null) {
  return {
    id: p.id,
    storeId: p.storeId,
    name: p.name,
    description: p.description,
    rewardType: p.rewardType,
    rewardValue: p.rewardValue,
    scopeType: p.scopeType,
    target: p.target,
    eligibilityMode: p.eligibilityMode,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    windowDays: p.windowDays,
    maxRedemptions: p.maxRedemptions,
    remaining,
  };
}

// Coerce/validate an incoming promotion definition (create/patch). Returns the
// column values or a string error message.
function buildPromotionValues(body: Record<string, unknown>, partial: boolean) {
  const v: Record<string, unknown> = {};
  const want = (k: string) => body[k] !== undefined;

  if (!partial || want("name")) {
    if (!body.name) return "name is required";
    v.name = String(body.name);
  }
  if (want("description")) v.description = String(body.description ?? "");

  if (!partial || want("rewardType")) {
    const rt = String(body.rewardType ?? "percent");
    if (rt !== "percent" && rt !== "amount") return "rewardType must be 'percent' or 'amount'";
    v.rewardType = rt;
  }
  if (!partial || want("rewardValue")) {
    const rv = Number(body.rewardValue);
    if (!Number.isFinite(rv) || rv <= 0) return "rewardValue must be a positive number";
    v.rewardValue = Math.round(rv);
  }
  if (!partial || want("scopeType")) {
    const st = String(body.scopeType ?? "store");
    if (!["item", "store", "category"].includes(st))
      return "scopeType must be 'item', 'store' or 'category'";
    v.scopeType = st;
  }
  if (want("target")) v.target = body.target == null ? null : String(body.target);

  if (!partial || want("eligibilityMode")) {
    const em = String(body.eligibilityMode ?? "fixed_end");
    if (em !== "fixed_end" && em !== "rolling")
      return "eligibilityMode must be 'fixed_end' or 'rolling'";
    v.eligibilityMode = em;
  }
  if (want("startsAt")) v.startsAt = body.startsAt ? new Date(String(body.startsAt)) : null;
  if (want("endsAt")) v.endsAt = body.endsAt ? new Date(String(body.endsAt)) : null;
  if (want("windowDays"))
    v.windowDays = body.windowDays == null ? null : Math.round(Number(body.windowDays));
  if (want("maxRedemptions"))
    v.maxRedemptions =
      body.maxRedemptions == null ? null : Math.max(0, Math.round(Number(body.maxRedemptions)));
  if (want("active")) v.active = !!body.active;

  return v;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async (req: Request) => {
  const url = new URL(req.url);
  const resource = url.pathname.replace(/\/+$/, "").split("/").pop();
  const now = new Date();

  try {
    // ---- Public reads & quote -------------------------------------------
    if (req.method === "GET" && resource !== "manage") {
      const storeId = url.searchParams.get("storeId");
      if (!storeId) return json(400, { error: "storeId is required" });
      const rows = await db
        .select()
        .from(promotions)
        .where(and(eq(promotions.storeId, storeId), eq(promotions.active, true)));
      const remaining = await remainingFor(rows);
      // Only advertise deals that still have stock (or are unlimited) and are
      // not already expired (a past fixed-end deadline). Rolling deals have no
      // shared deadline, so they stay visible and are gated per-cart by event date.
      const visible = rows.filter((p) => {
        const r = remaining[p.id];
        const inStock = r === null || r === undefined || r > 0;
        const notExpired =
          p.eligibilityMode === "rolling" || !p.endsAt || new Date(p.endsAt) >= now;
        return inStock && notExpired;
      });
      return json(200, {
        promotions: visible.map((p) => publicShape(p, remaining[p.id] ?? null)),
      });
    }

    if (req.method === "POST" && resource === "quote") {
      const body = (await req.json().catch(() => null)) as
        | { storeId?: string; cart?: CartLine[]; sessionId?: string }
        | null;
      if (!body || !body.storeId) return json(400, { error: "storeId is required" });
      const lines = Array.isArray(body.cart) ? body.cart : [];

      const rows = await db
        .select()
        .from(promotions)
        .where(and(eq(promotions.storeId, body.storeId), eq(promotions.active, true)));
      const remaining = await remainingFor(rows);
      const best = bestPromotionForCart(rows, lines, remaining, now);

      if (!best || best.discountCents <= 0) {
        return json(200, { discountCents: 0 });
      }

      // Short-lived signed proof that this discount is server-authorised, so
      // create-payment-intent can apply it without re-deriving the cart.
      let token: string | null = null;
      const secret = process.env.JWT_SECRET;
      if (secret) {
        token = jwt.sign(
          {
            promotionId: best.promotion.id,
            discountCents: best.discountCents,
            sessionId: body.sessionId || null,
            kind: "promo-discount",
          },
          secret,
          { expiresIn: "20m" },
        );
      }

      return json(200, {
        discountCents: best.discountCents,
        promotionId: best.promotion.id,
        promotionName: best.promotion.name,
        rewardType: best.promotion.rewardType,
        rewardValue: best.promotion.rewardValue,
        perLine: best.perLine,
        remaining: remaining[best.promotion.id] ?? null,
        token,
      });
    }

    // ---- Everything below requires auth + publish permission ------------
    const userId = getUserId(req);
    if (!userId) return json(401, { error: "Login required" });

    if (req.method === "GET" && resource === "manage") {
      const storeId = url.searchParams.get("storeId");
      if (!storeId) return json(400, { error: "storeId is required" });
      if (!(await userHasPublishPermissionForStore(storeId, userId)))
        return json(403, { error: "Forbidden" });
      const rows = await db
        .select()
        .from(promotions)
        .where(eq(promotions.storeId, storeId));
      const remaining = await remainingFor(rows);
      return json(200, {
        promotions: rows.map((p) => ({
          ...publicShape(p, remaining[p.id] ?? null),
          active: p.active,
          createdBy: p.createdBy,
          createdAt: p.createdAt,
        })),
      });
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "Invalid JSON body" });

    if (req.method === "POST") {
      const storeId = body.storeId ? String(body.storeId) : "";
      if (!storeId) return json(400, { error: "storeId is required" });
      if (!(await userHasPublishPermissionForStore(storeId, userId)))
        return json(403, { error: "Forbidden" });
      const values = buildPromotionValues(body, false);
      if (typeof values === "string") return json(400, { error: values });
      const [row] = await db
        .insert(promotions)
        .values({ ...(values as object), storeId, createdBy: userId } as typeof promotions.$inferInsert)
        .returning();
      return json(201, { promotion: row });
    }

    if (req.method === "PATCH") {
      const id = body.id == null ? null : Number(body.id);
      if (!id) return json(400, { error: "id is required" });
      const [existing] = await db.select().from(promotions).where(eq(promotions.id, id));
      if (!existing) return json(404, { error: "Not found" });
      if (!(await userHasPublishPermissionForStore(existing.storeId, userId)))
        return json(403, { error: "Forbidden" });
      const values = buildPromotionValues(body, true);
      if (typeof values === "string") return json(400, { error: values });
      if (Object.keys(values).length === 0) return json(400, { error: "No fields to update" });
      const [row] = await db
        .update(promotions)
        .set(values as Partial<typeof promotions.$inferInsert>)
        .where(eq(promotions.id, id))
        .returning();
      return json(200, { promotion: row });
    }

    if (req.method === "DELETE") {
      const id = body.id == null ? null : Number(body.id);
      if (!id) return json(400, { error: "id is required" });
      const [existing] = await db.select().from(promotions).where(eq(promotions.id, id));
      if (!existing) return json(404, { error: "Not found" });
      if (!(await userHasPublishPermissionForStore(existing.storeId, userId)))
        return json(403, { error: "Forbidden" });
      await db.delete(promotions).where(eq(promotions.id, id));
      return json(200, { deleted: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[promotions] error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: ["/api/promotions", "/api/promotions/*"],
};
