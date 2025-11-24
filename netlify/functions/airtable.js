// FILE: netlify/functions/airtable.js
// PURPOSE: This function now securely fetches the item list for the admin profiler.

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Validate environment variables
    if (!AIRTABLE_PAT || !BASE_ID) {
        console.error("[get-items-for-profiling] Missing required environment variables");
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    try {
        console.log("[get-items-for-profiling] Fetching all items from Airtable...");
        let allRecords = [];
        let offset = null;
        let pageCount = 0;
        const MAX_PAGES = 100; // Safety limit to prevent infinite loops

        // We only fetch Name and the new AI_Profile field
        const fieldsQuery = `fields%5B%5D=Name&fields%5B%5D=AI_Profile`;
        const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}?${fieldsQuery}`;

        do {
            pageCount++;
            if (pageCount > MAX_PAGES) {
                console.error(`[get-items-for-profiling] Exceeded maximum page limit of ${MAX_PAGES}`);
                throw new Error('Too many records to fetch');
            }

            let url = baseUrl;
            if (offset) {
                url += `&offset=${encodeURIComponent(offset)}`;
            }

            // Add timeout to prevent hanging requests
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` },
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[get-items-for-profiling] Airtable Error:`, errorText);
                throw new Error(`Failed to fetch items. Status: ${response.status}`);
            }

            const data = await response.json();

            // Validate response structure
            if (!data.records || !Array.isArray(data.records)) {
                throw new Error('Invalid response structure from Airtable');
            }

            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`[get-items-for-profiling] Total item records fetched: ${allRecords.length}`);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, max-age=60' // Cache for 1 minute
            },
            body: JSON.stringify(allRecords)
        };

    } catch (error) {
        console.error("[get-items-for-profiling] Function Error:", error.message);

        // Handle specific error types
        if (error.name === 'AbortError') {
            return {
                statusCode: 504,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Request timeout while fetching items' })
            };
        }

        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
