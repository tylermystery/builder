import type { Context, Config } from "@netlify/edge-functions";

const SITE_NAME = "WTFun";
const DEFAULT_IMAGE =
  "https://res.cloudinary.com/daedqizre/image/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/ww71meppejsewxsxr4x7.jpg";
const DEFAULT_DESCRIPTION =
  "Discover and plan amazing events and activities with WTFun.";

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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validItemId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{3,200}$/.test(value);
}

function extractItemId(url: URL): string | null {
  const explicit = url.searchParams.get("openItem");
  if (validItemId(explicit)) return explicit;

  const slug = url.pathname.replace(/^\/item\//, "");
  const recordMatch = slug.match(/rec[A-Za-z0-9]{14}$/);
  if (recordMatch) return recordMatch[0];
  const publicMatch = slug.match(/public-\d+$/);
  if (publicMatch) return publicMatch[0];
  const generatedMatch = slug.match(
    /(?:ai-(?:child|search|presentation)-[A-Za-z0-9._:-]+|manual-(?:add|presentation)-[A-Za-z0-9._:-]+|solution-[A-Za-z0-9._:-]+)$/,
  );
  return generatedMatch?.[0] || null;
}

async function fetchPreviewItem(origin: string, itemId: string): Promise<PreviewItem | null> {
  try {
    const endpoint = new URL("/api/item-preview", origin);
    endpoint.searchParams.set("itemId", itemId);
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json() as { item?: PreviewItem };
    return data.item || null;
  } catch (error) {
    console.error("[SEO Prerender] Preview API error:", error);
    return null;
  }
}

function canonicalUrlFor(requestUrl: URL, itemId: string): string {
  const canonical = new URL(requestUrl.pathname, requestUrl.origin);
  if (!/^rec[A-Za-z0-9]{14}$/.test(itemId)) {
    canonical.searchParams.set("openItem", itemId);
  }
  return canonical.toString();
}

function generateStructuredData(item: PreviewItem, canonicalUrl: string, image: string): string {
  const common = {
    "@context": "https://schema.org",
    name: item.name,
    description: item.description.slice(0, 500),
    image: [image],
    url: canonicalUrl,
  };
  if (item.itemType.toLowerCase() === "event" && item.startDate) {
    return JSON.stringify({
      ...common,
      "@type": "Event",
      startDate: item.startDate,
      eventStatus: "https://schema.org/EventScheduled",
      organizer: { "@type": "Organization", name: SITE_NAME },
    }).replace(/</g, "\\u003c");
  }
  return JSON.stringify({
    ...common,
    "@type": "Product",
    brand: { "@type": "Organization", name: SITE_NAME },
    category: item.categories.join(" > ") || undefined,
    offers: {
      "@type": "Offer",
      price: item.price,
      priceCurrency: "USD",
      availability: item.status === "Available" || item.status === "Featured"
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  }).replace(/</g, "\\u003c");
}

function generateMetaTags(item: PreviewItem, canonicalUrl: string): string {
  const title = `${item.name} | ${SITE_NAME}`;
  const description = (item.description || DEFAULT_DESCRIPTION).replace(/\s+/g, " ").slice(0, 160);
  const image = item.imageUrl || DEFAULT_IMAGE;
  const imageAlt = `${item.name} preview image`;
  const ogType = item.itemType.toLowerCase() === "event" ? "event" : "product";
  const cloudinarySized = image.includes("res.cloudinary.com") && image.includes("w_1200") && image.includes("h_630");
  const imageDimensions = cloudinarySized
    ? '<meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">'
    : "";

  return `
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}">
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

    <meta property="og:type" content="${ogType}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(image)}">
    <meta property="og:image:secure_url" content="${escapeHtml(image)}">
    <meta property="og:image:type" content="${escapeHtml(item.imageType || "image/jpeg")}">
    ${imageDimensions}
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
    <meta property="og:site_name" content="${SITE_NAME}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${escapeHtml(canonicalUrl)}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(image)}">
    <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">

    <meta name="robots" content="index, follow">
    ${item.categories.length ? `<meta name="keywords" content="${escapeHtml(item.categories.join(", "))}">` : ""}
    <script type="application/ld+json">${generateStructuredData(item, canonicalUrl, image)}</script>
  `;
}

function removeConflictingMetadata(html: string): string {
  return html
    .replace(/<title[^>]*>.*?<\/title>/gis, "")
    .replace(/<link[^>]+rel=["']canonical["'][^>]*>/gi, "")
    .replace(/<meta[^>]+(?:name|property)=["'](?:title|description|keywords|robots|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>.*?<\/script>/gis, "");
}

function isCrawler(userAgent: string): boolean {
  const crawlerPatterns = [
    "googlebot", "bingbot", "facebookexternalhit", "twitterbot", "linkedinbot",
    "whatsapp", "telegram", "discordbot", "slackbot", "skypeuripreview",
    "pinterest", "redditbot", "applebot", "embedly",
  ];
  const normalized = userAgent.toLowerCase();
  return crawlerPatterns.some((pattern) => normalized.includes(pattern));
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const requestUrl = new URL(req.url);
  if (!requestUrl.pathname.startsWith("/item/")) return context.next();
  const itemId = extractItemId(requestUrl);
  if (!itemId) return context.next();

  const [response, item] = await Promise.all([
    context.next(),
    fetchPreviewItem(requestUrl.origin, itemId),
  ]);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  if (!item) {
    return isCrawler(req.headers.get("user-agent") || "")
      ? new Response("Not Found", { status: 404 })
      : response;
  }

  const canonicalUrl = canonicalUrlFor(requestUrl, itemId);
  const html = removeConflictingMetadata(await response.text());
  const modifiedHtml = html.replace(
    /<head([^>]*)>/i,
    `<head$1>\n${generateMetaTags(item, canonicalUrl)}`,
  );
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set(
    "cache-control",
    isCrawler(req.headers.get("user-agent") || "")
      ? "public, max-age=3600, stale-while-revalidate=86400"
      : "private, no-cache",
  );
  return new Response(modifiedHtml, { status: response.status, headers });
}

export const config: Config = {
  path: "/item/*",
};
