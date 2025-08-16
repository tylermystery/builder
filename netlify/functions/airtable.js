// File: netlify/functions/airtable.js

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // Get Airtable API configuration from environment variables
    const { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;
    
    // Determine the Airtable API endpoint from the request path
    const path = event.path.replace('/.netlify/functions/airtable', '');
    const apiURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`;

    try {
        const response = await fetch(apiURL, {
            method: event.httpMethod,
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
            body: event.body,
        });

        const data = await response.json();

        return {
            statusCode: response.status,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch data from Airtable' }),
        };
    }
};
