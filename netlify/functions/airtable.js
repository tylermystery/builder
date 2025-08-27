/*
 * Version: 1.0.2 (with debugging)
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.0.2 - 2025-08-26
 * - Added detailed console logging for debugging purposes.
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    console.log("Airtable function invoked.");

    const { AIRTABLE_PAT, AIRTABLE_BASE_ID } = process.env;

    // --- Start of Debugging Logs ---
    console.log("--- Checking Environment Variables ---");
    console.log("Is AIRTABLE_PAT present:", !!AIRTABLE_PAT);
    console.log("Is AIRTABLE_BASE_ID present:", !!AIRTABLE_BASE_ID);
    // --- End of Debugging Logs ---

    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
        console.error("Server configuration error: Missing required environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing API credentials.' }),
        };
    }

    const path = event.path.replace('/.netlify/functions/airtable', '');
    const apiURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`;

    console.log(`Forwarding request to: ${apiURL}`);

    try {
        const response = await fetch(apiURL, {
            method: event.httpMethod,
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
           body: event.body,
        });
        
        console.log(`Airtable API responded with status: ${response.status}`);
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error("Airtable API Error Details:", data);
        }

        return {
            statusCode: response.status,
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('FATAL_ERROR in serverless function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'The serverless function encountered a fatal error.' }),
        };
    }
};
