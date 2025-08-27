/*
 * Version: 1.1.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.1.0 - 2025-08-26
 * - Fixed "TypeError: Request with GET/HEAD method cannot have body" by conditionally adding the body to the fetch request.
 *
 * v1.0.2 - 2025-08-26
 * - Added detailed console logging for debugging purposes.
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    const { AIRTABLE_PAT, AIRTABLE_BASE_ID } = process.env;

    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: Missing API credentials.' }),
        };
    }

    const path = event.path.replace('/.netlify/functions/airtable', '');
    const apiURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`;

    const fetchOptions = {
        method: event.httpMethod,
        headers: {
            'Authorization': `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json',
        }
    };

    // **THE FIX**: Only add a body for methods that are not GET or HEAD.
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
        fetchOptions.body = event.body;
    }

    try {
        const response = await fetch(apiURL, fetchOptions);
        const data = await response.json();
        
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
