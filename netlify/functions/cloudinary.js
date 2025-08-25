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
    } else {
        // This is a single-tag List API request
        apiURL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/tags/${encodeURIComponent(body.tag)}`;
        options = {
            method: 'GET',
            headers: { 'Authorization': auth }
        };
    }

    try {
        const response = await fetch(apiURL, options);
        if (!response.ok) {
            return { statusCode: response.status, body: JSON.stringify({ error: 'Failed to fetch from Cloudinary' }) };
        }
        const data = await response.json();
        return {
            statusCode: 200,
            body: JSON.stringify(data),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
