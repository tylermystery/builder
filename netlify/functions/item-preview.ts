import { Buffer } from "node:buffer";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { publicItems } from "../../db/schema.js";

type PreviewItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  imageType: string;
  categories: string[];
  status: string;
  itemType: string;
  startDate: string | null;
};

const DEFAULT_DESCRIPTION =
  "Discover and plan amazing events and activities with WTFun.";
const DEFAULT_IMAGE =
  "https://res.cloudinary.com/daedqizre/image/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/ww71meppejsewxsxr4x7.jpg";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200
        ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
    },
  });

function validItemId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{3,200}$/.test(value);
}

function validRecordId(value: unknown): value is string {
  return typeof value === "string" && /^rec[A-Za-z0-9]{14}$/.test(value);
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function socialImageUrl(value: unknown): string | null {
  const url = safeHttpUrl(value);
  if (!url) return null;
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    const [prefix, suffix] = url.split("/upload/", 2);
    if (prefix && suffix) {
      const parts = suffix.split("/");
      while (
        parts.length > 1 &&
        /^(?:[a-z]{1,3}_[^/]+)(?:,[a-z]{1,3}_[^/]+)*$/i.test(parts[0])
      ) {
        parts.shift();
      }
      return `${prefix}/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/${parts.join("/")}`;
    }
  }
  return url;
}

function imageTypeFor(url: string | null): string {
  if (!url) return "image/jpeg";
  if (url.includes("res.cloudinary.com") && url.includes("f_jpg")) return "image/jpeg";
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function firstImageFromFields(fields: Record<string, unknown>): string | null {
  const custom = fields._customImages;
  if (Array.isArray(custom)) {
    for (const entry of custom) {
      const url = typeof entry === "string" ? entry : (entry as { url?: unknown })?.url;
      const safe = socialImageUrl(url);
      if (safe) return safe;
    }
  }

  for (const key of ["Images", "Photos", "Image"]) {
    const value = fields[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const attachment = entry as { url?: unknown; thumbnails?: { large?: { url?: unknown } } };
      const safe = socialImageUrl(attachment.url || attachment.thumbnails?.large?.url);
      if (safe) return safe;
    }
  }

  for (const key of ["imageUrl", "ImageURL", "Image URL", "Image"]) {
    const safe = socialImageUrl(fields[key]);
    if (safe) return safe;
  }
  return null;
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return values.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 12);
}

async function fetchCuratedImage(fields: Record<string, unknown>): Promise<string | null> {
  const linkedIds = fields["Curated Images"];
  if (!Array.isArray(linkedIds)) return null;
  const ids = linkedIds.filter(validRecordId).slice(0, 20);
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId || ids.length === 0) return null;

  const formula = `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
  const params = new URLSearchParams({ filterByFormula: formula });
  params.append("fields[]", "ImageURL");
  params.append("sort[0][field]", "isBestOf");
  params.append("sort[0][direction]", "desc");
  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/Image_Gallery?${params}`,
    { headers: { Authorization: `Bearer ${pat}` } },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as {
    records?: Array<{ fields?: { ImageURL?: unknown } }>;
  };
  for (const record of data.records || []) {
    const image = socialImageUrl(record.fields?.ImageURL);
    if (image) return image;
  }
  return null;
}

async function fetchCloudinaryTagImage(value: unknown): Promise<string | null> {
  const tags = stringList(value);
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret || tags.length === 0) return null;

  const expression = tags
    .map((tag) => `tags:"${tag.replace(/["\\]/g, "")}"`)
    .join(" AND ");
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expression, max_results: 1 }),
    },
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { resources?: Array<{ secure_url?: unknown }> };
  return socialImageUrl(data.resources?.[0]?.secure_url);
}

async function resolveImage(fields: Record<string, unknown>, fallback?: unknown) {
  return (
    (await fetchCuratedImage(fields)) ||
    firstImageFromFields(fields) ||
    socialImageUrl(fallback) ||
    (await fetchCloudinaryTagImage(fields["Media Tags"])) ||
    DEFAULT_IMAGE
  );
}

async function fetchAirtableItem(itemId: string): Promise<PreviewItem | null> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.BASE_ID;
  if (!pat || !baseId || !validRecordId(itemId)) return null;
  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/tblUA4uuS8IYlhKpD/${encodeURIComponent(itemId)}`,
    { headers: { Authorization: `Bearer ${pat}` } },
  );
  if (!response.ok) return null;
  const row = (await response.json()) as { id: string; fields?: Record<string, unknown> };
  const fields = row.fields || {};
  const imageUrl = await resolveImage(fields);
  return {
    id: row.id,
    name: String(fields.Name || "WTFun item"),
    description: String(fields.Description || DEFAULT_DESCRIPTION),
    price: Number.parseFloat(String(fields.Price || 0)) || 0,
    imageUrl,
    imageType: imageTypeFor(imageUrl),
    categories: stringList(fields.Categories),
    status: String(fields.Status || "Available"),
    itemType: String(fields["Item Type"] || "Product"),
    startDate: fields["Start Date"] || fields["Event Date"] || fields.Date
      ? String(fields["Start Date"] || fields["Event Date"] || fields.Date)
      : null,
  };
}

async function fetchPublicItem(itemId: string): Promise<PreviewItem | null> {
  const numericId = /^public-(\d+)$/.exec(itemId)?.[1];
  const condition = numericId
    ? eq(publicItems.id, Number(numericId))
    : or(eq(publicItems.originItemId, itemId), eq(publicItems.catalogItemId, itemId));
  const [row] = await db
    .select()
    .from(publicItems)
    .where(and(condition, eq(publicItems.hidden, false)))
    .limit(1);
  if (!row) return null;

  const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : {};
  const fields = data.fields && typeof data.fields === "object"
    ? data.fields as Record<string, unknown>
    : {};
  const imageUrl = await resolveImage(fields, row.imageUrl);
  return {
    id: `public-${row.id}`,
    name: row.name || String(fields.Name || "WTFun item"),
    description: row.description || String(fields.Description || DEFAULT_DESCRIPTION),
    price: Number.parseFloat(String(row.price || fields.Price || 0)) || 0,
    imageUrl,
    imageType: imageTypeFor(imageUrl),
    categories: stringList(fields.Categories),
    status: String(fields.Status || "Available"),
    itemType: String(fields["Item Type"] || "Product"),
    startDate: fields["Start Date"] || fields["Event Date"] || fields.Date
      ? String(fields["Start Date"] || fields["Event Date"] || fields.Date)
      : null,
  };
}

export default async (req: Request) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  const itemId = new URL(req.url).searchParams.get("itemId");
  if (!validItemId(itemId)) return json(400, { error: "Valid itemId is required" });

  try {
    const item = (validRecordId(itemId) ? await fetchAirtableItem(itemId) : null) ||
      await fetchPublicItem(itemId);
    return item ? json(200, { item }) : json(404, { error: "Item not found" });
  } catch (error) {
    console.error("[item-preview] error:", error);
    return json(500, { error: "Internal server error" });
  }
};

export const config = {
  path: "/api/item-preview",
};
