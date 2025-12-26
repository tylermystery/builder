/*
 * Version: 1.0.0
 * Last Modified: 2025-08-25
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-25
 * - Initial version created to act as a secure proxy for the Cloudinary API.
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // Get Cloudinary credentials from secure environment variables
    const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

    // === IMAGE DEBUG: Log incoming request ===
    console.log('[IMAGE DEBUG] Cloudinary function CALLED');
    console.log('[IMAGE DEBUG] Request body:', event.body);
    console.log('[IMAGE DEBUG] CLOUDINARY_CLOUD_NAME configured:', !!CLOUDINARY_CLOUD_NAME);

    // The client will send the search/list request details in the body
    const body = JSON.parse(event.body);
    let apiURL;
    let options;

    const auth = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');

    if (body.expression) {
        // This is a multi-tag Search API request
        apiURL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/search`;
        options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': auth },
            body: JSON.stringify({ expression: body.expression, max_results: 10 })
        };
        console.log('[IMAGE DEBUG] Multi-tag search - expression:', body.expression);
        console.log('[IMAGE DEBUG] Cloudinary Search API URL:', apiURL);
    } else {
        // This is a single-tag List API request
        apiURL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/tags/${encodeURIComponent(body.tag)}`;
        options = {
            method: 'GET',
            headers: { 'Authorization': auth }
        };
        console.log('[IMAGE DEBUG] Single-tag search - tag:', body.tag);
        console.log('[IMAGE DEBUG] Cloudinary List API URL:', apiURL);
    }

    try {
        const response = await fetch(apiURL, options);
        console.log('[IMAGE DEBUG] Cloudinary API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.log('[IMAGE DEBUG] Cloudinary API error response:', errorText);
            return { statusCode: response.status, body: JSON.stringify({ error: 'Failed to fetch from Cloudinary', details: errorText }) };
        }
        const data = await response.json();
        console.log('[IMAGE DEBUG] Cloudinary API success - resources count:', data.resources ? data.resources.length : 0);
        if (data.resources && data.resources.length > 0) {
            console.log('[IMAGE DEBUG] First resource:', JSON.stringify(data.resources[0]).substring(0, 300));
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.log('[IMAGE DEBUG] Cloudinary function error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
