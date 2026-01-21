// FILE: netlify/functions/sitemap.js
// PURPOSE: Generates a dynamic sitemap.xml with all product/event URLs for SEO
// URL: https://whatthefunfinder.netlify.app/sitemap.xml

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const SITE_URL = 'https://whatthefun.wtf';

/**
 * Generates a URL-friendly slug from a name string
 * IMPORTANT: This must match the logic in utils.js generateSlug() to avoid redirect issues
 */
function generateSlug(name, recordId, tags = []) {
    if (!name || typeof name !== 'string') {
        return recordId;
    }

    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    // Add up to 3 SEO-friendly tags if available (matching utils.js)
    if (tags.length > 0) {
        const seoTags = tags.slice(0, 3).map(tag =>
            tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        ).filter(tag => tag.length > 0 && !slug.includes(tag));

        if (seoTags.length > 0) {
            slug = `${slug}-${seoTags.join('-')}`;
        }
    }

    // Limit total length for reasonable URLs (matching utils.js - 60 chars max before recordId)
    slug = slug.substring(0, 60);

    // Append full record ID (not shortened) - matching utils.js
    return `${slug}-${recordId}`;
}

/**
 * Escapes special XML characters
 */
function escapeXml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Extracts AI tags from AI_Profile field
 */
function extractTags(record) {
    const aiProfileString = record.fields.AI_Profile || record.fields.Rankings;
    if (aiProfileString) {
        try {
            const aiProfile = JSON.parse(aiProfileString);
            return aiProfile.Tags || aiProfile.SearchTerms || [];
        } catch (e) {
            return [];
        }
    }
    return [];
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("[sitemap] Generating dynamic sitemap...");
        let allRecords = [];
        let offset = null;

        // Fetch minimal fields needed for sitemap
        const fieldsToFetch = ['Name', 'Status', 'AI_Profile', 'Rankings'];
        const fieldsQuery = fieldsToFetch.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join('&');

        // Only fetch active/published items
        const filterFormula = encodeURIComponent("OR({Status}='Active', {Status}='Published', {Status}='')");
        const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}?${fieldsQuery}&filterByFormula=${filterFormula}`;

        do {
            let url = baseUrl;
            if (offset) {
                url += `&offset=${offset}`;
            }
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[sitemap] Airtable Error:`, errorText);
                throw new Error(`Failed to fetch items. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`[sitemap] Total records fetched: ${allRecords.length}`);

        const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        // Static pages
        let urlEntries = `
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/start-a-plan.html</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`;

        // Dynamic item pages
        for (const record of allRecords) {
            const name = record.fields.Name;
            if (!name) continue;

            const tags = extractTags(record);
            const slug = generateSlug(name, record.id, tags);
            const itemUrl = `${SITE_URL}/item/${slug}`;

            urlEntries += `
  <url>
    <loc>${escapeXml(itemUrl)}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
        }

        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
            },
            body: sitemap
        };

    } catch (error) {
        console.error("[sitemap] Function Error:", error.message);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/xml' },
            body: `<?xml version="1.0" encoding="UTF-8"?><error>${escapeXml(error.message)}</error>`
        };
    }
};
