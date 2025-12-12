// FILE: netlify/functions/post-plan-event.js
// PURPOSE: Posts plan events to the Messages table for history tracking
// Events appear in the session chat as system messages showing plan activity

const fetch = require('node-fetch');

const { AIRTABLE_PAT, BASE_ID } = process.env;

const MESSAGES_TABLE = 'Messages';
const DEBUG_PREFIX = '[post-plan-event]';

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

function debugLog(action, data = null) {
    const timestamp = new Date().toISOString();
    if (data !== null) {
        console.log(`${DEBUG_PREFIX} [${timestamp}] ${action}:`, JSON.stringify(data, null, 2));
    } else {
        console.log(`${DEBUG_PREFIX} [${timestamp}] ${action}`);
    }
}

exports.handler = async (event) => {
    debugLog('Function invoked', { method: event.httpMethod });

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    if (!AIRTABLE_PAT || !BASE_ID) {
        debugLog('ERROR: Missing required environment variables');
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    try {
        const { sessionId, eventType, eventData } = JSON.parse(event.body || '{}');

        if (!sessionId || !sessionId.startsWith('rec')) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid or missing sessionId' })
            };
        }

        if (!eventType || !Object.values(PLAN_EVENT_TYPES).includes(eventType)) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid or missing eventType' })
            };
        }

        debugLog('Posting plan event', { sessionId, eventType });

        const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MESSAGES_TABLE)}`;

        // Format the event content as JSON string for storage
        const eventContent = JSON.stringify({
            type: eventType,
            data: eventData || {},
            timestamp: new Date().toISOString()
        });

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

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
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
        debugLog('Event posted successfully', { recordId: result.records[0].id });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                recordId: result.records[0].id
            })
        };

    } catch (error) {
        debugLog('Function failed', { error: error.message, stack: error.stack });

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
