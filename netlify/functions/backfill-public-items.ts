// netlify/functions/backfill-public-items.ts
//
// One-time, idempotent, re-runnable backfill that promotes every AI / custom /
// solution item embedded in past plans into the public_items table so it becomes
// public within its originating store. Reactions and comments are intentionally
// NOT migrated — public items start with a clean slate.
//
// Idempotency: each promoted row is keyed by (origin_session_id, origin_item_id)
// via a unique index, and inserts use ON CONFLICT DO NOTHING, so running the
// backfill repeatedly never creates duplicates.
//
// This is an administrative trigger and requires a logged-in user (Bearer JWT
// signed with JWT_SECRET). Invoke with: POST /api/backfill-public-items

import jwt from "jsonwebtoken";
import { db } from "../../db/index.js";
import { publicItems } from "../../db/schema.js";

const { JWT_SECRET, AIRTABLE_PAT, BASE_ID } = process.env;
const SESSIONS_TABLE = "Sessions";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

function isAuthed(req: Request): boolean {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ") || !JWT_SECRET) return false;
  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as {
      userId?: string;
    };
    return !!(decoded && decoded.userId);
  } catch {
    return false;
  }
}

// Classify a stored custom record into one of the three public sources.
function classify(record: any, itemId: string): string {
  if (record?.isSolution || /^solution/i.test(itemId)) return "solution";
  if (record?.isManual || /^manual/i.test(itemId)) return "custom";
  if (record?.isAI || /^ai/i.test(itemId)) return "ai";
  return "custom";
}

// Best-effort extraction of a representative image from the many shapes a record
// may carry. The full record is preserved in `data` regardless, so rendering is
// never dependent on this guess.
function extractImage(fields: any): string | null {
  if (!fields) return null;
  const custom = fields._customImages;
  if (Array.isArray(custom) && custom.length) {
    const first = custom[0];
    return typeof first === "string" ? first : first?.url || null;
  }
  if (typeof fields.ImageURL === "string") return fields.ImageURL;
  if (Array.isArray(fields.Photos) && fields.Photos.length) {
    return fields.Photos[0]?.url || null;
  }
  if (typeof fields.Image === "string") return fields.Image;
  return null;
}

export default async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!JWT_SECRET || !AIRTABLE_PAT || !BASE_ID)
    return json(500, { error: "Server configuration error" });
  if (!isAuthed(req)) return json(401, { error: "Login required" });

  try {
    let offset: string | undefined;
    let sessionsScanned = 0;
    let itemsFound = 0;
    let inserted = 0;
    const rows: (typeof publicItems.$inferInsert)[] = [];

    // Page through every session.
    do {
      const url = new URL(
        `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}`,
      );
      url.searchParams.set("pageSize", "100");
      url.searchParams.append("fields[]", "Items with Variations");
      url.searchParams.append("fields[]", "Stores");
      url.searchParams.append("fields[]", "Collaborators");
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[backfill] Airtable error", res.status, text);
        return json(502, { error: "Failed to read sessions from Airtable" });
      }
      const page: any = await res.json();

      for (const session of page.records || []) {
        sessionsScanned += 1;
        const raw = session.fields?.["Items with Variations"];
        if (!raw) continue;

        let parsed: any;
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          continue; // skip unparseable session JSON
        }
        const aiRecords = parsed?.aiRecords;
        if (!aiRecords || typeof aiRecords !== "object") continue;

        const stores = session.fields?.Stores;
        const storeId = Array.isArray(stores) && stores.length ? stores[0] : null;
        // Without an originating store there is no place to surface the item.
        if (!storeId) continue;

        const collaborators = session.fields?.Collaborators;
        const authorId =
          Array.isArray(collaborators) && collaborators.length
            ? collaborators[0]
            : null;

        for (const [itemId, record] of Object.entries<any>(aiRecords)) {
          if (!record) continue;
          const fields = record.fields || {};
          const name = fields.Name || record.name;
          if (!name) continue; // nothing meaningful to publish
          itemsFound += 1;
          rows.push({
            storeId: String(storeId),
            source: classify(record, itemId),
            originSessionId: session.id,
            originItemId: String(record.id || itemId),
            authorId: authorId ? String(authorId) : null,
            name: String(name),
            description: fields.Description ? String(fields.Description) : "",
            imageUrl: extractImage(fields),
            price: fields.Price != null ? String(fields.Price) : null,
            data: record,
          });
        }
      }

      offset = page.offset;
    } while (offset);

    // Insert in chunks, skipping any (session, item) already present.
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      if (!chunk.length) continue;
      const result = await db
        .insert(publicItems)
        .values(chunk)
        .onConflictDoNothing({
          target: [publicItems.originSessionId, publicItems.originItemId],
        })
        .returning({ id: publicItems.id });
      inserted += result.length;
    }

    return json(200, {
      success: true,
      sessionsScanned,
      itemsFound,
      inserted,
      skippedExisting: itemsFound - inserted,
    });
  } catch (err) {
    console.error("[backfill] error:", err);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: "/api/backfill-public-items",
};
