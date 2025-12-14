// FILE: netlify/functions/post-plan-event.js
// PURPOSE: Posts plan events to the Messages table for history tracking
// Events appear in the session chat as system messages showing plan activity

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID } = process.env;

const MESSAGES_TABLE = 'Messages';
const DEBUG_PREFIX = '[PLAN-EVENT]';

/**
 * Debug logger for plan event posting
 * @param {string} action - The action being performed
 * @param {any} data - Data to log (optional)
 */
function debugLog(action, data = null) {
    const timestamp = new Date().toISOString();
    const logData = data !== null ? `: ${JSON.stringify(data)}` : '';
    console.log(`${DEBUG_PREFIX} ${action}${logData}`);
}

/**
 * Event types for plan history tracking
 */
const PLAN_EVENT_TYPES = {
    PLAN_CREATED: 'plan_created',
    AI_INTERPRETATION: 'ai_interpretation',
    PLAN_UPDATED: 'plan_updated',
    TASK_ADDED: 'task_added',
    ITEM_ADDED: 'item_added',
    COLLABORATOR_JOINED: 'collaborator_joined'
};

exports.handler = async (event) => {
    console.log(`${DEBUG_PREFIX} ========== FUNCTION START ==========`);
    debugLog('Handler invoked', { httpMethod: event.httpMethod, hasBody: !!event.body });

    if (event.httpMethod !== 'POST') {
        debugLog('Rejected: not a POST request', { method: event.httpMethod });
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    if (!AIRTABLE_PAT || !BASE_ID) {
        console.error(`${DEBUG_PREFIX} ERROR: Missing AIRTABLE_PAT or BASE_ID`);
        debugLog('Config error', { hasAirtablePat: !!AIRTABLE_PAT, hasBaseId: !!BASE_ID });
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    debugLog('Environment validated', { hasAirtablePat: true, hasBaseId: true });

    try {
        const requestBody = event.body || '{}';
        debugLog('Raw request body received', { length: requestBody.length, preview: requestBody.substring(0, 200) });

        const { sessionId, eventType, eventData } = JSON.parse(requestBody);
        debugLog('Request body parsed', {
            sessionId,
            eventType,
            hasEventData: !!eventData,
            eventDataKeys: eventData ? Object.keys(eventData) : []
        });

        if (!sessionId || !sessionId.startsWith('rec')) {
            console.error(`${DEBUG_PREFIX} Invalid sessionId: ${sessionId}`);
            debugLog('Validation failed: invalid sessionId', { sessionId });
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid or missing sessionId' })
            };
        }

        if (!eventType || !Object.values(PLAN_EVENT_TYPES).includes(eventType)) {
            console.error(`${DEBUG_PREFIX} Invalid eventType: ${eventType}`);
            debugLog('Validation failed: invalid eventType', { eventType, validTypes: Object.values(PLAN_EVENT_TYPES) });
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid or missing eventType' })
            };
        }

        console.log(`${DEBUG_PREFIX} Posting ${eventType} event for session ${sessionId}`);
        debugLog('Preparing to post event', { sessionId, eventType });

        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MESSAGES_TABLE)}`;

        // Format the event content as JSON string for storage
        const eventContent = JSON.stringify({
            type: eventType,
            data: eventData || {},
            timestamp: new Date().toISOString()
        });

        debugLog('Event content prepared', { contentLength: eventContent.length, contentPreview: eventContent.substring(0, 200) });

        const payload = {
            records: [{
                fields: {
                    SessionID: [sessionId],
                    SenderID: 'system',
                    SenderName: 'System',
                    Content: eventContent,
                    EventType: eventType
                }
            }]
        };

        console.log(`${DEBUG_PREFIX} Creating message record with SessionID=[${sessionId}], EventType=${eventType}`);
        debugLog('Airtable payload prepared', {
            fieldNames: Object.keys(payload.records[0].fields),
            sessionId: payload.records[0].fields.SessionID
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        debugLog('Airtable response received', { status: response.status, ok: response.ok });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`${DEBUG_PREFIX} ❌ Airtable error: ${response.status}`, errorBody);
            debugLog('Airtable error', { status: response.status, error: errorBody });
            // Return success anyway - event logging shouldn't fail the main operation
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    error: 'Failed to save event',
                    details: errorBody
                })
            };
        }

        const result = await response.json();
        console.log(`${DEBUG_PREFIX} ✅ Event posted: ${result.records[0].id}`);
        debugLog('Event posted successfully', {
            recordId: result.records[0].id,
            sessionId,
            eventType,
            createdTime: result.records[0].createdTime
        });
        console.log(`${DEBUG_PREFIX} ========== FUNCTION END (success) ==========`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                recordId: result.records[0].id
            })
        };

    } catch (error) {
        console.error(`${DEBUG_PREFIX} FUNCTION FAILED:`, error.message);
        debugLog('Function error', { error: error.message, stack: error.stack });
        console.log(`${DEBUG_PREFIX} ========== FUNCTION END (error) ==========`);

        // Return success anyway - event logging is non-critical
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};

// Export event types for other functions to use
exports.PLAN_EVENT_TYPES = PLAN_EVENT_TYPES;
