// FILE: netlify/functions/auth-verify.js (REPLACE ENTIRE FILE)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// Define table/field names as constants
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID/Name
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Airtable
const OWNED_STORE_FIELD = 'OwnedStore';
const OWNER_DASHBOARD_ID_FIELD = 'OwnerDashboardID';
const ASSOCIATED_SESSIONS_FIELD = 'Associated Sessions';
const NAME_FIELD = 'Name';
const EMAIL_FIELD = 'Email';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { token } = JSON.parse(event.body);
        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token is required.' }) };
        }

        // 1. Verify Magic Link Token
        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const tokenData = await tokenRes.json();
        if (!tokenData.records || tokenData.records.length === 0) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token.' }) };
        }

        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt } = magicLinkRecord.fields;

        if (new Date() > new Date(ExpiresAt)) {
             await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } }); // Clean up expired token
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token.' }) };
        }

        // Delete the used magic link token immediately
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        // 2. Find or Create User
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({${EMAIL_FIELD}}='${Email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        let userData = await userRes.json();
        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-verify] Found existing user: ${userRecord.id}`);
        } else {
            console.log(`[auth-verify] Creating new user for email: ${Email}`);
            const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
            const createUserRes = await fetch(createUserUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { [EMAIL_FIELD]: Email, [NAME_FIELD]: Email.split('@')[0] } }] })
            });
             if (!createUserRes.ok) throw new Error('Failed to create user in Airtable.');
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-verify] Created new user: ${userRecord.id}`);
        }

        // 3. Check for Store Ownership
        let ownerData = { isOwner: false, ownerDashboardId: null };
        if (userRecord.fields[OWNED_STORE_FIELD] && userRecord.fields[OWNED_STORE_FIELD].length > 0) {
            const storeId = userRecord.fields[OWNED_STORE_FIELD][0];
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}?fields[]=${encodeURIComponent(OWNER_DASHBOARD_ID_FIELD)}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields[OWNER_DASHBOARD_ID_FIELD]) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields[OWNER_DASHBOARD_ID_FIELD];
                    console.log(`[auth-verify] User ${userRecord.id} is owner of store ${storeId}. Dashboard ID: ${ownerData.ownerDashboardId}`);
                }
            } else {
                 console.warn(`[auth-verify] Could not fetch owned store details for store ID: ${storeId}`);
            }
        }

        // 4. Fetch Associated Session Names
        let associatedSessions = [];
        const sessionIds = userRecord.fields[ASSOCIATED_SESSIONS_FIELD];
        if (sessionIds && sessionIds.length > 0) {
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}?fields[]=${encodeURIComponent(NAME_FIELD)}&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({ id: rec.id, name: rec.fields[NAME_FIELD] || 'Unnamed Session' }));
                console.log(`[auth-verify] Found ${associatedSessions.length} associated sessions for user ${userRecord.id}`);
            } else {
                 console.warn(`[auth-verify] Could not fetch associated sessions for user ${userRecord.id}`);
            }
        }

        // --- START NEW LIKES FETCH ---
        // 5. Fetch Liked Item IDs
        let likedItemIds = [];
        // Note: Airtable formulas using FIND on linked records can be tricky/slow.
        // It might be more reliable if you query the Items table directly.
        // Formula component: FIND('recUserIdXYZ', ARRAYJOIN({Liked By Users})) > 0
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        // We only need the record IDs, so don't request any specific fields.
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`; // Empty fields array means just get IDs

        console.log(`[auth-verify] Fetching liked items for user ${userRecord.id} with formula: ${likedItemsFormula}`);
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-verify] Found ${likedItemIds.length} liked items for user ${userRecord.id}.`);
        } else {
            console.warn(`[auth-verify] Failed to fetch liked items for user ${userRecord.id}. Status: ${likedItemsRes.status}`);
            // Don't fail the login, just proceed without liked items if the fetch fails
        }
        // --- END NEW LIKES FETCH ---

        // 6. Generate Session JWT
        const userPayloadForToken = {
            userId: userRecord.id,
            name: userRecord.fields[NAME_FIELD],
            email: userRecord.fields[EMAIL_FIELD],
            isOwner: ownerData.isOwner
            // We don't include likedItemIds in the JWT itself to keep it smaller,
            // but we will return it alongside the token.
        };
        const sessionToken = jwt.sign(userPayloadForToken, JWT_SECRET, { expiresIn: '30d' });

        // 7. Return Response to Client
        return {
            statusCode: 200,
            body: JSON.stringify({
                token: sessionToken,
                user: {
                    id: userRecord.id,
                    name: userRecord.fields[NAME_FIELD],
                    email: userRecord.fields[EMAIL_FIELD],
                    associatedSessions: associatedSessions,
                    likedItemIds: likedItemIds // Include the fetched liked item IDs here
                },
                ownerData: ownerData
            }),
        };
    } catch (error) {
        console.error('[auth-verify] Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal error occurred.' }),
        };
    }
};
