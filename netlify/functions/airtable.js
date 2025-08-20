/*
 * Version: 1.0.0
 * Last Modified: 2025-08-17
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 [cite_start]*/ [cite: 414]

// File: netlify/functions/airtable.js

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // Get Airtable API configuration from environment variables
    const { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } = process.env;
    [cite_start]// Determine the Airtable API endpoint from the request path [cite: 415]
    const path = event.path.replace('/.netlify/functions/airtable', '');
    [cite_start]const apiURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`; [cite: 416]

    try {
        const response = await fetch(apiURL, {
            method: event.httpMethod,
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
         
           [cite_start]body: event.body, [cite: 417]
        });

        const data = await response.json();
        [cite_start]return { [cite: 418]
            statusCode: response.status,
            body: JSON.stringify(data),
        };
    [cite_start]} catch (error) { [cite: 419]
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch data from Airtable' }),
        };
    [cite_start]} [cite: 420]
};
