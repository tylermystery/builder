/*
 * Version: 2.0.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v2.0.0 - 2025-08-26
 * - Function now accepts a 'url' query parameter to fetch any iCal feed dynamically.
 *
 * v1.0.0 - 2025-08-26
 * - Initial version. Fetches and parses a remote iCal feed.
 */

const fetch = require('node-fetch');

// A simple, dependency-free iCal parser.
function parseICal(icalData) {
    const events = [];
    const eventBlocks = icalData.split('BEGIN:VEVENT');
    eventBlocks.shift(); // Remove the header

    eventBlocks.forEach(block => {
        const startMatch = block.match(/DTSTART(?:;[^:]+)?:([0-9T]+)/);
        const endMatch = block.match(/DTEND(?:;[^:]+)?:([0-9T]+)/);

        if (startMatch && endMatch) {
            events.push({
                start: startMatch[1],
                end: endMatch[1]
            });
        }
    });
    return events;
}

exports.handler = async function (event, context) {
    // Validate HTTP method
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed. Use GET.' }),
        };
    }

    const { url } = event.queryStringParameters || {};

    if (!url) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
        };
    }

    // Validate URL format
    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(url);
        const urlObj = new URL(decodedUrl);
        // Only allow http and https protocols for security
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid URL protocol. Only HTTP and HTTPS are allowed.' }),
            };
        }
    } catch (urlError) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid URL format.' }),
        };
    }

    try {
        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(decodedUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Netlify-Calendar-Proxy/1.0'
            }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Failed to fetch iCal feed with status: ${response.status} ${response.statusText}`);
        }

        const icalData = await response.text();

        // Validate that we received some data
        if (!icalData || icalData.trim().length === 0) {
            throw new Error('Received empty iCal data');
        }

        const busyTimes = parseICal(icalData);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
            },
            body: JSON.stringify(busyTimes),
        };
    } catch (error) {
        console.error('iCal fetch/parse error:', error);

        // Handle specific error types
        if (error.name === 'AbortError') {
            return {
                statusCode: 504,
                body: JSON.stringify({ error: 'Request timeout while fetching calendar data.' }),
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process calendar data.' }),
        };
    }
};
