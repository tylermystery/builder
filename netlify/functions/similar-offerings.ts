import jwt from "jsonwebtoken";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { similarOfferings } from "../../db/schema.js";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const validExternalId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{3,100}$/.test(value);

function getUserId(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JWT_SECRET;
  if (!authHeader.startsWith("Bearer ") || !secret) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret) as { userId?: string };
    return decoded.userId || null;
  } catch {
    return null;
  }
}

async function userHasPublishPermissionForStore(storeId: string, userId: string) {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId) return false;
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/${baseId}/Stores/${encodeURIComponent(storeId)}`,
      { headers: { Authorization: `Bearer ${pat}` } },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { fields?: { PublishPermission?: unknown } };
    return Array.isArray(data.fields?.PublishPermission) &&
      data.fields.PublishPermission.includes(userId);
  } catch {
    return false;
  }
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");
    const itemId = url.searchParams.get("itemId");

    if (req.method === "GET") {
      if (!validExternalId(storeId) || !validExternalId(itemId)) {
        return json(400, { error: "Valid storeId and itemId are required" });
      }
      const rows = await db
        .select({ relatedItemId: similarOfferings.relatedCatalogItemId })
        .from(similarOfferings)
        .where(
          and(
            eq(similarOfferings.storeId, storeId),
            eq(similarOfferings.catalogItemId, itemId),
          ),
        )
        .orderBy(asc(similarOfferings.position));
      return json(200, { relatedItemIds: rows.map((row) => row.relatedItemId) });
    }

    if (req.method === "PUT") {
      const userId = getUserId(req);
      if (!userId) return json(401, { error: "Login required" });
      const body = (await req.json().catch(() => null)) as {
        storeId?: unknown;
        itemId?: unknown;
        relatedItemIds?: unknown;
      } | null;
      if (
        !body ||
        !validExternalId(body.storeId) ||
        !validExternalId(body.itemId) ||
        !Array.isArray(body.relatedItemIds)
      ) {
        return json(400, { error: "Valid storeId, itemId, and relatedItemIds are required" });
      }
      const storeId = body.storeId;
      const itemId = body.itemId;
      if (!(await userHasPublishPermissionForStore(storeId, userId))) {
        return json(403, { error: "Forbidden" });
      }

      const relatedItemIds = [...new Set(body.relatedItemIds)]
        .filter(validExternalId)
        .filter((id) => id !== itemId)
        .slice(0, 4);

      await db.transaction(async (tx) => {
        await tx
          .delete(similarOfferings)
          .where(
            and(
              eq(similarOfferings.storeId, storeId),
              eq(similarOfferings.catalogItemId, itemId),
            ),
          );
        if (relatedItemIds.length > 0) {
          await tx.insert(similarOfferings).values(
            relatedItemIds.map((relatedCatalogItemId, position) => ({
              storeId,
              catalogItemId: itemId,
              relatedCatalogItemId,
              position,
              createdBy: userId,
            })),
          );
        }
      });

      return json(200, { relatedItemIds });
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("[similar-offerings] error:", error);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: "/api/similar-offerings",
};
