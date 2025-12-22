// FILE: netlify/functions/toggle-like.js

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Ensure JWT_SECRET, AIRTABLE_PAT, and BASE_ID are set in Netlify environment variables
const { JWT_SECRET, AIRTABLE_PAT, BASE_ID } = process.env;
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID/Name
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Airtable

exports.handler = async (event) => {
    // Validate environment variables
    if (!JWT_SECRET || !AIRTABLE_PAT || !BASE_ID) {
        console.error('[toggle-like] Missing required environment variables');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // --- Authentication ---
    const authHeader = event.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }) };
    }
    const token = authHeader.split(' ')[1];
    let userId;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
        if (!userId) throw new Error('Invalid token payload.');
    } catch (error) {
        console.error('JWT Verification Error:', error.message);
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Invalid or expired token.' }) };
    }
    // --- End Authentication ---

    try {
        // Defensive: validate request body
        if (!event.body) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body.' }) };
        }

        let parsedBody;
        try {
            parsedBody = JSON.parse(event.body);
        } catch (parseError) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
        }

        const { itemId } = parsedBody;
        if (!itemId || typeof itemId !== 'string') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid itemId in request body.' }) };
        }

        // Validate itemId format (Airtable record IDs start with 'rec')
        if (!itemId.startsWith('rec')) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid itemId format.' }) };
        }

        console.log(`[toggle-like] User ${userId} toggling like for item ${itemId}`);

        // 1. Fetch the Item record (only the Liked By Users field)
        const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}/${itemId}?fields[]=${encodeURIComponent(LIKED_BY_FIELD)}`;
        const itemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (!itemRes.ok) {
            if (itemRes.status === 404) {
                 return { statusCode: 404, body: JSON.stringify({ error: `Item with ID ${itemId} not found.` }) };
            }
            console.error(`Airtable fetch error (${itemRes.status}):`, await itemRes.text());
            throw new Error(`Failed to fetch item ${itemId} from Airtable.`);
        }

        const itemRecord = await itemRes.json();
        const likedUserIds = itemRecord.fields?.[LIKED_BY_FIELD] || []; // Default to empty array if field is missing or null

        // Defensive: ensure likedUserIds is an array
        const safeUserIds = Array.isArray(likedUserIds) ? likedUserIds : [];
        const userIndex = safeUserIds.indexOf(userId);
        let updatedUserIds;
        let liked = false;

        // 2. Determine new state and update list
        if (userIndex > -1) {
            // User already liked it, remove them (unlike)
            updatedUserIds = safeUserIds.filter(id => id !== userId);
            liked = false;
            console.log(`[toggle-like] User ${userId} unliking item ${itemId}.`);
        } else {
            // User hasn't liked it, add them (like)
            updatedUserIds = [...safeUserIds, userId];
            liked = true;
            console.log(`[toggle-like] User ${userId} liking item ${itemId}.`);
        }

        // 3. Update the Item record in Airtable
        const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}/${itemId}`;
        const payload = {
            fields: {
                [LIKED_BY_FIELD]: updatedUserIds
            }
        };

        const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!patchRes.ok) {
            console.error(`Airtable patch error (${patchRes.status}):`, await patchRes.text());
            throw new Error(`Failed to update likes for item ${itemId} in Airtable.`);
        }

        console.log(`[toggle-like] Successfully updated likes for item ${itemId}. New status: ${liked ? 'Liked' : 'Unliked'}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, liked: liked }) // Return the new liked status
        };

    } catch (error) {
        console.error('[toggle-like] Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};
