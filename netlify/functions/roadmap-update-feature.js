const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ROADMAP_TABLE = 'Roadmap_Ideas';

exports.handler = async (event) => {
    if (event.httpMethod !== 'PATCH') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const { recordId, fields } = JSON.parse(event.body);
        
        if (!recordId || !fields) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: recordId and fields' })
            };
        }

        console.log('[roadmap-update-feature] Updating feature:', recordId);

        const payload = {
            fields: fields
        };

        const url = `https://api.airtable.com/v0/${BASE_ID}/${ROADMAP_TABLE}/${recordId}`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[roadmap-update-feature] Airtable Error:', errorText);
            throw new Error(`Failed to update feature. Status: ${response.status}`);
        }

        const data = await response.json();
        
        console.log('[roadmap-update-feature] Successfully updated feature:', recordId);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('[roadmap-update-feature] Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
