// FILE: netlify/functions/merchant-feed.js
// PURPOSE: Generates a Google Merchant Center compatible product feed in XML format
// URL: https://whatthefunfinder.netlify.app/api/merchant-feed

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const SITE_URL = 'https://whatthefun.wtf';

/**
 * Generates a URL-friendly slug from a name string (mirrors utils.js logic)
 */
function generateSlug(name, recordId, tags = []) {
    if (!name || typeof name !== 'string') {
        return recordId;
    }

    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    // Add up to 2 SEO-friendly tags if available
    if (tags.length > 0) {
        const seoTags = tags.slice(0, 2).map(tag =>
            tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        ).filter(tag => tag.length > 0 && !slug.includes(tag));

        if (seoTags.length > 0) {
            slug = `${slug}-${seoTags.join('-')}`;
        }
    }

    const shortId = recordId.replace('rec', '');
    return `${slug}-${shortId}`;
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

/**
 * Gets the first image URL from the record
 */
function getImageUrl(record) {
    if (record.fields.Images && record.fields.Images.length > 0) {
        return record.fields.Images[0].url || '';
    }
    return '';
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("[merchant-feed] Fetching all items from Airtable...");
        let allRecords = [];
        let offset = null;

        // Fetch fields needed for Google Merchant Center feed
        const fieldsToFetch = [
            'Name',
            'Description',
            'Price',
            'Images',
            'Item Type',
            'Categories',
            'Subcategories',
            'Status',
            'AI_Profile',
            'Rankings'
        ];
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
                console.error(`[merchant-feed] Airtable Error:`, errorText);
                throw new Error(`Failed to fetch items. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`[merchant-feed] Total records fetched: ${allRecords.length}`);

        // Generate XML feed
        const now = new Date().toISOString();
        let xmlItems = '';

        for (const record of allRecords) {
            const name = record.fields.Name;
            if (!name) continue; // Skip items without names

            const tags = extractTags(record);
            const slug = generateSlug(name, record.id, tags);
            const itemUrl = `${SITE_URL}/item/${slug}`;
            const imageUrl = getImageUrl(record);
            const description = record.fields.Description || name;
            const price = record.fields.Price || 0;
            const itemType = record.fields['Item Type'] || 'Product';
            const categories = record.fields.Categories || [];
            const subcategories = record.fields.Subcategories || [];

            // Build category path for Google
            let googleCategory = 'Activities & Entertainment';
            if (categories.length > 0) {
                googleCategory = categories[0];
                if (subcategories.length > 0) {
                    googleCategory += ` > ${subcategories[0]}`;
                }
            }

            xmlItems += `
    <item>
      <g:id>${escapeXml(record.id)}</g:id>
      <g:title>${escapeXml(name)}</g:title>
      <g:description>${escapeXml(description.substring(0, 5000))}</g:description>
      <g:link>${escapeXml(itemUrl)}</g:link>
      ${imageUrl ? `<g:image_link>${escapeXml(imageUrl)}</g:image_link>` : ''}
      <g:availability>in_stock</g:availability>
      <g:price>${price.toFixed(2)} USD</g:price>
      <g:condition>new</g:condition>
      <g:brand>WTFun</g:brand>
      <g:product_type>${escapeXml(googleCategory)}</g:product_type>
      ${itemType === 'Event' ? '<g:custom_label_0>Event</g:custom_label_0>' : '<g:custom_label_0>Service</g:custom_label_0>'}
      ${tags.length > 0 ? `<g:custom_label_1>${escapeXml(tags.slice(0, 3).join(', '))}</g:custom_label_1>` : ''}
    </item>`;
        }

        const xmlFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>WTFun Product Feed</title>
    <link>${SITE_URL}</link>
    <description>Event planning services and activities from WTFun</description>
    <lastBuildDate>${now}</lastBuildDate>
${xmlItems}
  </channel>
</rss>`;

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: xmlFeed
        };

    } catch (error) {
        console.error("[merchant-feed] Function Error:", error.message);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/xml' },
            body: `<?xml version="1.0" encoding="UTF-8"?><error>${escapeXml(error.message)}</error>`
        };
    }
};
