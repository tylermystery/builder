const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const ROADMAP_TABLE = 'Roadmap_Ideas';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    try {
        const { feature, description } = JSON.parse(event.body);
        
        if (!feature || !description) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields: feature and description' })
            };
        }

        console.log('[roadmap-create-feature] Creating new feature:', feature);

        const payload = {
            records: [{
                fields: {
                    Feature: feature,
                    Description: description,
                    Status: 'Backlog',
                    Suggested_By: 'Team'
                }
            }]
        };

        const url = `https://api.airtable.com/v0/${BASE_ID}/${ROADMAP_TABLE}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[roadmap-create-feature] Airtable Error:', errorText);
            throw new Error(`Failed to create feature. Status: ${response.status}`);
        }

        const data = await response.json();
        const newRecord = data.records[0];
        
        console.log('[roadmap-create-feature] Successfully created feature:', newRecord.id);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newRecord)
        };

    } catch (error) {
        console.error('[roadmap-create-feature] Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
