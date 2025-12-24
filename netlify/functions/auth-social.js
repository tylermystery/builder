// FILE: netlify/functions/auth-social.js
// Handles user authentication/registration via Netlify Identity (Google SSO)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Define table/field names as constants
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID/Name
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Airtable
const RSVPS_FIELD = 'RSVPs'; // Exact field name from Airtable Items table
const OWNED_STORE_FIELD = 'OwnedStore';
const OWNER_DASHBOARD_ID_FIELD = 'OwnerDashboardID';
const ASSOCIATED_SESSIONS_FIELD = 'Associated Sessions';
const NAME_FIELD = 'Name';
const EMAIL_FIELD = 'Email';

exports.handler = async (event, context) => {
    console.log('[auth-social] ========== HANDLER START ==========');

    // Check for required environment variables
    const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

    if (!AIRTABLE_PAT) {
        console.error('[auth-social] ERROR: AIRTABLE_PAT environment variable is not set');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    if (!BASE_ID) {
        console.error('[auth-social] ERROR: BASE_ID environment variable is not set');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    if (!JWT_SECRET) {
        console.error('[auth-social] ERROR: JWT_SECRET environment variable is not set');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // 1. Verify Netlify Identity User
    const { user } = context.clientContext || {};
    console.log('[auth-social] Client context present:', !!context.clientContext);
    console.log('[auth-social] User present:', !!user);

    if (!user) {
        console.error('[auth-social] ERROR: No user in client context - unauthorized');
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };
    }

    try {
        const { email, user_metadata } = user;
        const name = user_metadata?.full_name || email.split('@')[0]; // Use full name if available
        console.log(`[auth-social] Processing social login for email: ${email}, name: ${name}`);

        // 2. Find or Create User in Airtable
        // Use double quotes and encodeURIComponent for proper escaping
        const filterFormula = encodeURIComponent(`{${EMAIL_FIELD}}="${email}"`);
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=${filterFormula}`;
        console.log('[auth-social] Finding user with email:', email);

        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        console.log('[auth-social] Find user response status:', userRes.status);

        if (!userRes.ok) {
            const errorText = await userRes.text();
            console.error('[auth-social] ERROR finding user:', errorText);
            throw new Error(`Failed to query users table: ${userRes.status}`);
        }

        const userData = await userRes.json();
        console.log('[auth-social] Found users:', userData.records?.length || 0);

        let userRecord;
        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-social] Found existing user: ${userRecord.id}`);
            // Optional: Update name if it changed in the social provider
            if (userRecord.fields[NAME_FIELD] !== name) {
                console.log(`[auth-social] Updating user name for ${userRecord.id}`);
                await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userRecord.id}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { [NAME_FIELD]: name } })
                });
                // Update local record for subsequent steps
                userRecord.fields[NAME_FIELD] = name;
            }
        } else {
            console.log(`[auth-social] Creating new user for email: ${email}`);
            const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
            const createUserRes = await fetch(createUserUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { [EMAIL_FIELD]: email, [NAME_FIELD]: name } }] })
            });
            if (!createUserRes.ok) {
                const errorText = await createUserRes.text();
                console.error('[auth-social] ERROR creating user:', errorText);
                throw new Error('Failed to create user in Airtable via social auth.');
            }
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-social] Created new user: ${userRecord.id}`);
        }

        // 3. Check for Store Ownership
        let ownerData = { isOwner: false, ownerDashboardId: null, ownedStoreId: null };
        if (userRecord.fields[OWNED_STORE_FIELD] && userRecord.fields[OWNED_STORE_FIELD].length > 0) {
            const storeId = userRecord.fields[OWNED_STORE_FIELD][0];
            ownerData.ownedStoreId = storeId;
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}?fields[]=${encodeURIComponent(OWNER_DASHBOARD_ID_FIELD)}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields[OWNER_DASHBOARD_ID_FIELD]) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields[OWNER_DASHBOARD_ID_FIELD];
                    console.log(`[auth-social] User ${userRecord.id} is owner of store ${storeId}. Dashboard ID: ${ownerData.ownerDashboardId}`);
                }
            } else {
                console.warn(`[auth-social] Could not fetch owned store details for store ID: ${storeId}`);
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
                console.log(`[auth-social] Found ${associatedSessions.length} associated sessions for user ${userRecord.id}`);
            } else {
                console.warn(`[auth-social] Could not fetch associated sessions for user ${userRecord.id}`);
            }
        }

        // 5. Fetch Liked Item IDs
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;

        console.log(`[auth-social] Fetching liked items for user ${userRecord.id}...`);
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-social] Found ${likedItemIds.length} liked items for user ${userRecord.id}.`);
        } else {
            console.warn(`[auth-social] Failed to fetch liked items for user ${userRecord.id}. Status: ${likedItemsRes.status}`);
        }

        // 6. Fetch RSVP'd Item IDs (Events)
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;

        console.log(`[auth-social] Fetching RSVP'd items for user ${userRecord.id}...`);
        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-social] Found ${rsvpdItemIds.length} RSVP'd items.`);
        } else {
            console.warn(`[auth-social] Failed to fetch RSVP'd items for user ${userRecord.id}. Status: ${rsvpdItemsRes.status}`);
        }

        // 7. Generate Session JWT
        const userPayloadForToken = {
            userId: userRecord.id,
            name: userRecord.fields[NAME_FIELD] || name,
            email: email,
            isOwner: ownerData.isOwner
        };
        const sessionToken = jwt.sign(userPayloadForToken, JWT_SECRET, { expiresIn: '30d' });
        console.log('[auth-social] JWT token generated successfully');

        // 8. Return Response to Client
        console.log('[auth-social] ========== HANDLER SUCCESS ==========');
        return {
            statusCode: 200,
            body: JSON.stringify({
                token: sessionToken,
                user: {
                    id: userRecord.id,
                    name: userRecord.fields[NAME_FIELD] || name,
                    email: email,
                    likedItemIds: likedItemIds,
                    rsvpdItemIds: rsvpdItemIds,
                    associatedSessions: associatedSessions
                },
                ownerData: ownerData
            }),
        };
    } catch (error) {
        console.error('[auth-social] ========== HANDLER ERROR ==========');
        console.error('[auth-social] Error name:', error.name);
        console.error('[auth-social] Error message:', error.message);
        console.error('[auth-social] Error stack:', error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};
