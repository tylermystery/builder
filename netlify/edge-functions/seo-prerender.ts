/**
 * SEO Prerender Edge Function
 *
 * This edge function intercepts requests to /item/* pages and injects SEO metadata
 * (Open Graph tags, Twitter Cards, JSON-LD structured data) into the HTML response.
 *
 * This solves the "soft 404" issue where Google sees empty pages because the SPA
 * content loads via JavaScript, which crawlers don't always execute.
 */

import type { Context, Config } from "@netlify/edge-functions";

const SITE_URL = 'https://whatthefun.wtf';
const SITE_NAME = 'WTFun';
const DEFAULT_IMAGE = 'https://res.cloudinary.com/dxvlilrqq/image/upload/v1/wtfun/default-og-image.jpg';
const DEFAULT_DESCRIPTION = 'Discover and plan amazing events and activities with WTFun - your event planning companion.';

interface ItemData {
  id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  categories: string[];
  status: string;
}

/**
 * Extract Airtable record ID from the URL slug
 * Slugs are in format: item-name-tags-recXXXXXXXXXXXXXX
 */
function extractRecordId(slug: string): string | null {
  // Airtable record IDs start with "rec" and are 17 chars total
  const match = slug.match(/rec[A-Za-z0-9]{14}$/);
  return match ? match[0] : null;
}

/**
 * Fetch item data from Airtable
 */
async function fetchItemData(recordId: string): Promise<ItemData | null> {
  const airtablePat = Netlify.env.get('AIRTABLE_PAT');
  const baseId = Netlify.env.get('BASE_ID');

  if (!airtablePat || !baseId) {
    console.error('[SEO Prerender] Missing Airtable credentials');
    return null;
  }

  const itemsTable = 'tblUA4uuS8IYlhKpD';
  const url = `https://api.airtable.com/v0/${baseId}/${itemsTable}/${recordId}`;

  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${airtablePat}` }
    });

    if (!response.ok) {
      console.error(`[SEO Prerender] Airtable error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const fields = data.fields || {};

    // Extract images from the Images field (Airtable attachments)
    const images: string[] = [];
    if (fields.Images && Array.isArray(fields.Images)) {
      for (const img of fields.Images) {
        if (img.url) {
          images.push(img.url);
        } else if (img.thumbnails?.large?.url) {
          images.push(img.thumbnails.large.url);
        }
      }
    }

    // Parse categories
    const categories: string[] = [];
    if (fields.Categories) {
      categories.push(...String(fields.Categories).split(',').map(c => c.trim()).filter(Boolean));
    }

    return {
      id: data.id,
      name: fields.Name || 'Item',
      description: fields.Description || DEFAULT_DESCRIPTION,
      price: parseFloat(fields.Price) || 0,
      images,
      categories,
      status: fields.Status || 'Available'
    };
  } catch (error) {
    console.error('[SEO Prerender] Fetch error:', error);
    return null;
  }
}

/**
 * Generate JSON-LD structured data for the item
 */
function generateStructuredData(item: ItemData, url: string): string {
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": item.name,
    "description": item.description.substring(0, 500),
    "image": item.images.length > 0 ? item.images : [DEFAULT_IMAGE],
    "url": url,
    "brand": {
      "@type": "Organization",
      "name": SITE_NAME
    },
    "offers": {
      "@type": "Offer",
      "price": item.price,
      "priceCurrency": "USD",
      "availability": item.status === 'Available' || item.status === 'Featured'
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": SITE_NAME
      }
    }
  };

  // Add category if available
  if (item.categories.length > 0) {
    (productSchema as any).category = item.categories.join(' > ');
  }

  return JSON.stringify(productSchema);
}

/**
 * Generate meta tags HTML string
 */
function generateMetaTags(item: ItemData, url: string): string {
  const title = `${item.name} | ${SITE_NAME}`;
  const description = item.description.substring(0, 160).replace(/\n/g, ' ');
  const image = item.images[0] || DEFAULT_IMAGE;
  const price = item.price > 0 ? `$${item.price.toFixed(2)}` : 'Contact for pricing';

  return `
    <!-- Primary Meta Tags (SEO Prerender) -->
    <title>${escapeHtml(title)}</title>
    <meta name="title" content="${escapeHtml(title)}">
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${url}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="product">
    <meta property="og:url" content="${url}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${image}">
    <meta property="og:site_name" content="${SITE_NAME}">
    <meta property="product:price:amount" content="${item.price}">
    <meta property="product:price:currency" content="USD">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${url}">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${image}">

    <!-- Additional SEO signals -->
    <meta name="robots" content="index, follow">
    <meta name="price" content="${price}">
    ${item.categories.length > 0 ? `<meta name="keywords" content="${escapeHtml(item.categories.join(', '))}">` : ''}

    <!-- JSON-LD Structured Data -->
    <script type="application/ld+json">
    ${generateStructuredData(item, url)}
    </script>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if the request is from a known crawler/bot
 */
function isCrawler(userAgent: string): boolean {
  const crawlerPatterns = [
    'googlebot',
    'bingbot',
    'yandex',
    'baiduspider',
    'duckduckbot',
    'slurp',
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegram',
    'discordbot',
    'applebot',
    'pinterest',
    'semrushbot',
    'ahrefsbot',
    'mj12bot',
    'dotbot'
  ];

  const ua = userAgent.toLowerCase();
  return crawlerPatterns.some(pattern => ua.includes(pattern));
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Only process /item/* paths
  if (!pathname.startsWith('/item/')) {
    return context.next();
  }

  // Extract slug from path
  const slug = pathname.replace('/item/', '').split('?')[0];
  if (!slug) {
    return context.next();
  }

  // Extract record ID from slug
  const recordId = extractRecordId(slug);
  if (!recordId) {
    console.log(`[SEO Prerender] No valid record ID in slug: ${slug}`);
    return context.next();
  }

  // Check if this is a crawler - for regular users, just pass through
  const userAgent = req.headers.get('user-agent') || '';
  const isBot = isCrawler(userAgent);

  // Get the original response
  const response = await context.next();

  // Only modify HTML responses
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('text/html')) {
    return response;
  }

  // Fetch item data from Airtable
  const itemData = await fetchItemData(recordId);

  if (!itemData) {
    // Item not found - let the SPA handle it (will show 404 message)
    // But for crawlers, we should ideally return 404
    if (isBot) {
      console.log(`[SEO Prerender] Item not found for bot: ${recordId}`);
      // Return 404 for crawlers if item doesn't exist
      return new Response('Not Found', { status: 404 });
    }
    return response;
  }

  // Get the HTML content
  const html = await response.text();

  // Build the canonical URL
  const canonicalUrl = `${SITE_URL}${pathname}`;

  // Generate meta tags
  const metaTags = generateMetaTags(itemData, canonicalUrl);

  // Inject meta tags into the <head> section
  // Replace existing title and description, add new tags after them
  let modifiedHtml = html;

  // Remove existing generic meta tags that we'll replace
  modifiedHtml = modifiedHtml.replace(/<title>.*?<\/title>/i, '');
  modifiedHtml = modifiedHtml.replace(/<meta name="description"[^>]*>/i, '');

  // Insert our SEO tags right after <head>
  modifiedHtml = modifiedHtml.replace(
    /<head([^>]*)>/i,
    `<head$1>\n${metaTags}`
  );

  // Return modified response with proper headers
  return new Response(modifiedHtml, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      'content-type': 'text/html; charset=utf-8',
      // Add cache headers - cache for crawlers
      'cache-control': isBot ? 'public, max-age=3600' : 'private, no-cache'
    }
  });
}

export const config: Config = {
  path: "/item/*"
};
