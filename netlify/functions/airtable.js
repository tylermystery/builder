/*
 * Version: 1.0.2
 * Last Modified: 2025-08-19
 *
 * Changelog:
 *
 * v1.0.2 - 2025-08-19
 * - Added extensive console logging for debugging the 500 internal server error.
 * - Improved error message returned in the catch block.
 *
 * v1.0.1 - 2025-08-19
 * - Fixed a critical syntax error (extra closing brace) that caused a 500 internal server error.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    console.log("--- Netlify Function Invoked ---");

    try {
        // 1. Log incoming request path
        console.log(`Received event path: ${event.path}`);

        // 2. Check for and log environment variables (safely)
        const { AIRTABLE_PAT, AIRTABLE_BASE_ID } = process.env;
        console.log(`AIRTABLE_BASE_ID exists: ${!!AIRTABLE_BASE_ID}`);
        console.log(`AIRTABLE_PAT exists: ${!!AIRTABLE_PAT}`);

        if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
            console.error("Missing required environment variables.");
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Server configuration error: Missing API credentials." }),
            };
        }

        // 3. Log the processed path and final URL
        const path = event.path.replace('/.netlify/functions/airtable', '');
        console.log(`Processed path for Airtable: ${path}`);
        
        const apiURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`;
        console.log(`Constructed Airtable API URL: ${apiURL}`);

        // 4. Make the request to Airtable
        const response = await fetch(apiURL, {
            method: event.httpMethod,
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
            body: event.body,
        });
        
        console.log(`Airtable response status: ${response.status}`);

        const data = await response.json();

        // 5. Return the response to the client
        return {
            statusCode: response.status,
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error("--- ERROR IN NETLIFY FUNCTION ---", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'The server function encountered an error.',
                errorMessage: error.message
            }),
        };
    }
};
