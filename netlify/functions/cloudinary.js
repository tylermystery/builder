/*
 * Version: 2.0.0
 * Last Modified: 2025-12-03
 *
 * Changelog:
 *
 * v2.0.0 - 2025-12-03
 * - Added server-side caching using Netlify Blobs (10 minute TTL)
 * - Added Cache-Control headers for browser caching
 * - Added request deduplication to prevent parallel calls for same data
 *
 * v1.0.0 - 2025-08-25
 * - Initial version created to act as a secure proxy for the Cloudinary API.
 */

const fetch = require('node-fetch');
const { getStore } = require('@netlify/blobs');

// Cache TTL in seconds (10 minutes)
const CACHE_TTL_SECONDS = 600;

// In-memory request deduplication for concurrent requests
const pendingRequests = new Map();

// Generate a cache key from the request body
function getCacheKey(body) {
    if (body.expression) {
        return `expr:${body.expression}`;
    } else if (body.tag) {
        return `tag:${body.tag}`;
    }
    return null;
}

// Check if cached data is still valid
function isCacheValid(cachedData) {
    if (!cachedData || !cachedData.timestamp) return false;
    const age = Date.now() - cachedData.timestamp;
    return age < CACHE_TTL_SECONDS * 1000;
}

exports.handler = async function (event, context) {
    // Get Cloudinary credentials from secure environment variables
    const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

    // The client will send the search/list request details in the body
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid request body' }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    }

    const cacheKey = getCacheKey(body);
    if (!cacheKey) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing expression or tag in request' }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    }

    // Initialize Netlify Blobs store for caching
    let store;
    try {
        store = getStore('cloudinary-cache');
    } catch (e) {
        console.warn('Could not initialize Netlify Blobs store:', e.message);
        // Continue without caching if store initialization fails
    }

    // Check for cached response
    if (store) {
        try {
            const cachedData = await store.get(cacheKey, { type: 'json' });
            if (cachedData && isCacheValid(cachedData)) {
                console.log(`Cache HIT for ${cacheKey}`);
                return {
                    statusCode: 200,
                    body: JSON.stringify(cachedData.data),
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`,
                        'X-Cache': 'HIT'
                    }
                };
            }
        } catch (e) {
            console.warn('Cache read error:', e.message);
            // Continue with API call if cache read fails
        }
    }

    // Check for pending request with same key (deduplication)
    if (pendingRequests.has(cacheKey)) {
        console.log(`Deduplicating request for ${cacheKey}`);
        try {
            const result = await pendingRequests.get(cacheKey);
            return result;
        } catch (e) {
            // If pending request fails, continue to make new request
        }
    }

    // Create the API request promise and store it for deduplication
    const apiRequestPromise = (async () => {
        const auth = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');
        let apiURL;
        let options;

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

            // Handle rate limiting from Cloudinary
            if (response.status === 429) {
                return {
                    statusCode: 429,
                    body: JSON.stringify({ error: 'Cloudinary rate limit exceeded. Please try again later.' }),
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': response.headers.get('Retry-After') || '60'
                    }
                };
            }

            if (!response.ok) {
                return {
                    statusCode: response.status,
                    body: JSON.stringify({ error: 'Failed to fetch from Cloudinary' }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };
            }

            const data = await response.json();

            // Cache the successful response
            if (store) {
                try {
                    await store.setJSON(cacheKey, {
                        data: data,
                        timestamp: Date.now()
                    });
                    console.log(`Cache STORED for ${cacheKey}`);
                } catch (e) {
                    console.warn('Cache write error:', e.message);
                    // Continue even if cache write fails
                }
            }

            console.log(`Cache MISS for ${cacheKey}`);
            return {
                statusCode: 200,
                body: JSON.stringify(data),
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=60`,
                    'X-Cache': 'MISS'
                }
            };
        } catch (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message }),
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        }
    })();

    // Store the promise for deduplication
    pendingRequests.set(cacheKey, apiRequestPromise);

    try {
        const result = await apiRequestPromise;
        return result;
    } finally {
        // Clean up the pending request after completion
        pendingRequests.delete(cacheKey);
    }
};
