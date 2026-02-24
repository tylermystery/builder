// FILE: netlify/functions/get-stream-info.js
// v3.8 Phase 5+6: Returns stream metadata for a given session/plan.
// Used by the viewer page to check if a stream is active and get connection info.
// Phase 6: Also returns focus item name for state sync.
// No authentication required — viewer access is public by design (decision #6).

const { AIRTABLE_PAT, BASE_ID } = process.env;
const SESSIONS_TABLE = 'Sessions';

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
        };
    }

    const sessionId = event.queryStringParameters?.sessionId;

    if (!sessionId) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'sessionId query parameter is required' }),
        };
    }

    if (!AIRTABLE_PAT || !BASE_ID) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Server configuration error' }),
        };
    }

    try {
        const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE}/${sessionId}`;
        const response = await fetch(sessionUrl, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Session not found', streamActive: false }),
                };
            }
            throw new Error(`Airtable request failed: ${response.status}`);
        }

        const record = await response.json();
        console.log('[get-stream-info] Session record found for', sessionId, '- has Items with Variations:', !!record.fields?.['Items with Variations']);
        let sessionMeta = {};
        try {
            sessionMeta = JSON.parse(record.fields?.['Items with Variations'] || '{}');
        } catch {
            console.warn('[get-stream-info] Failed to parse Items with Variations JSON for session', sessionId);
            sessionMeta = {};
        }

        const streamMeta = sessionMeta._streamMeta || {};
        console.log('[get-stream-info] _streamMeta:', JSON.stringify(streamMeta));
        const planName = record.fields?.['Session Name'] || record.fields?.['Name'] || 'Untitled Plan';

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                sessionId,
                planName,
                streamActive: !!streamMeta.active,
                hostUserId: streamMeta.hostUserId || null,
                channelName: streamMeta.channelName || null,
                startedAt: streamMeta.startedAt || null,
                focusItemName: streamMeta.focusItemName || null, // Phase 6: for viewer state sync
            }),
        };
    } catch (error) {
        console.error('[get-stream-info] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to retrieve stream information' }),
        };
    }
};
