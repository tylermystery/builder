const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ROADMAP_TABLE = 'Roadmap_Ideas';

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        console.log('[roadmap-get-features] Fetching all features from Airtable...');
        
        let allRecords = [];
        let offset = null;
        
        const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${ROADMAP_TABLE}`;

        do {
            let url = baseUrl;
            if (offset) {
                url += `?offset=${offset}`;
            }
            
            const response = await fetch(url, {
                headers: { 
                    'Authorization': `Bearer ${AIRTABLE_PAT}` 
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[roadmap-get-features] Airtable Error:', errorText);
                throw new Error(`Failed to fetch features. Status: ${response.status}`);
            }
            
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
            
        } while (offset);

        console.log(`[roadmap-get-features] Successfully fetched ${allRecords.length} features`);
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allRecords)
        };

    } catch (error) {
        console.error('[roadmap-get-features] Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
