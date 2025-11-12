const fetch = require('node-fetch');

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.BASE_ID || 'app5yTznb3R5YNUFw';
const ITEMS_TABLE_NAME = 'Items';

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Missing or invalid authorization token' })
        };
    }

    const token = authHeader.substring(7);
    let userId;
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.exp * 1000 < Date.now()) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Token expired' })
            };
        }
        userId = payload.userId;
    } catch (error) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid token' })
        };
    }

    const { eventId, action } = JSON.parse(event.body);

    if (!eventId || !action) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing eventId or action' })
        };
    }

    if (action !== 'add' && action !== 'remove') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid action. Must be "add" or "remove"' })
        };
    }

    try {
        const eventUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE_NAME}/${eventId}`;
        
        const getResponse = await fetch(eventUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (!getResponse.ok) {
            throw new Error(`Failed to fetch event: ${getResponse.statusText}`);
        }

        const eventRecord = await getResponse.json();
        
        if (eventRecord.fields['Item Type'] !== 'Event') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Record is not an event' })
            };
        }

        let currentRsvps = eventRecord.fields.RSVPs || [];
        
        let updated = false;
        if (action === 'add' && !currentRsvps.includes(userId)) {
            currentRsvps.push(userId);
            updated = true;
        } else if (action === 'remove' && currentRsvps.includes(userId)) {
            currentRsvps = currentRsvps.filter(id => id !== userId);
            updated = true;
        }

        if (updated) {
            const patchResponse = await fetch(eventUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_PAT}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fields: {
                        RSVPs: currentRsvps
                    }
                })
            });

            if (!patchResponse.ok) {
                throw new Error(`Failed to update RSVPs: ${patchResponse.statusText}`);
            }
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                rsvped: action === 'add',
                rsvpCount: currentRsvps.length
            })
        };
    } catch (error) {
        console.error('RSVP error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process RSVP' })
        };
    }
};
