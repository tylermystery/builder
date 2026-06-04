// FILE: netlify/functions/event-cover-image.js
// Stores and serves the "main photo" for published events.
//
// The Visual Scene Builder lets a planner compose a scene for their plan. When
// they save that scene as the event's main photo, the rendered image is uploaded
// to Cloudinary and its URL is recorded here, keyed by the event's record id.
//
// Storage shape: a single JSON document ("covers") holding the whole
// { [eventId]: imageUrl } map. The map is read as a whole at app startup to
// hydrate event cards everywhere, and updated one key at a time when a planner
// saves a new scene. This read-as-a-whole usage is the canonical Netlify Blobs
// pattern (see the netlify-blobs skill).

const STORE_NAME = 'event-cover-images';
const MAP_KEY = 'covers';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    let getStore, connectLambda;
    try {
        ({ getStore, connectLambda } = require('@netlify/blobs'));
    } catch (err) {
        console.error('[event-cover-image] @netlify/blobs not available:', err.message);
        return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Blob storage unavailable' }) };
    }

    // This is a legacy V1 (Lambda-compatible) function, so the Blobs environment
    // is not auto-injected the way it is for V2 functions. connectLambda reads the
    // Blobs context out of the Lambda `event` object and configures the store; it
    // must run before getStore(), otherwise getStore throws MissingBlobsEnvironmentError.
    connectLambda(event);

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    try {
        if (event.httpMethod === 'GET') {
            const map = (await store.get(MAP_KEY, { type: 'json' })) || {};
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ covers: map }) };
        }

        if (event.httpMethod === 'POST') {
            const { eventId, imageUrl } = JSON.parse(event.body || '{}');

            // Validate the event id looks like an Airtable record id and the URL is a
            // real https image link, so we never persist obviously bad data.
            if (typeof eventId !== 'string' || !eventId.startsWith('rec')) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'A valid eventId is required.' }) };
            }
            if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'A valid https imageUrl is required.' }) };
            }

            // Read-modify-write the whole map. Publishing scenes is a rare, manual
            // action, so contention on this single document is not a concern.
            const map = (await store.get(MAP_KEY, { type: 'json' })) || {};
            map[eventId] = imageUrl;
            await store.setJSON(MAP_KEY, map);

            console.log(`[event-cover-image] Saved main photo for event ${eventId}`);
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
        }

        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    } catch (error) {
        console.error('[event-cover-image] Error:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
    }
};
