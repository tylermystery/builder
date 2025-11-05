// FILE: netlify/functions/airtable.js
// PURPOSE: This function now securely fetches the item list for the admin profiler.

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log("[get-items-for-profiling] Fetching all items from Airtable...");
        let allRecords = [];
        let offset = null;
        
        // We only fetch Name and the new AI_Profile field
        const fieldsQuery = `fields%5B%5D=Name&fields%5B%5D=AI_Profile`;
        const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}?${fieldsQuery}`;

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
                console.error(`[get-items-for-profiling] Airtable Error:`, errorText);
                throw new Error(`Failed to fetch items. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log(`[get-items-for-profiling] Total item records fetched: ${allRecords.length}`);
        
        return {
            statusCode: 200,
            body: JSON.stringify(allRecords)
        };

    } catch (error) {
        console.error("[get-items-for-profiling] Function Error:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
