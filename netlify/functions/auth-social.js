// FILE: netlify/functions/auth-social.js
// Handles Google SSO authentication via Netlify Identity

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// Define table/field names as constants
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID/Name
const LIKED_BY_FIELD = 'Liked By Users';
const RSVPS_FIELD = 'RSVPs';
const OWNED_STORE_FIELD = 'OwnedStore';
const OWNER_DASHBOARD_ID_FIELD = 'OwnerDashboardID';
const ASSOCIATED_SESSIONS_FIELD = 'Associated Sessions';
const NAME_FIELD = 'Name';
const EMAIL_FIELD = 'Email';

exports.handler = async (event, context) => {
    console.log('[auth-social] ========== FUNCTION INVOKED ==========');
    console.log('[auth-social] Timestamp:', new Date().toISOString());
    console.log('[auth-social] HTTP Method:', event.httpMethod);

    // Debug: Check environment variables (without exposing values)
    console.log('[auth-social] Environment check:');
    console.log('[auth-social]   - AIRTABLE_PAT set:', !!AIRTABLE_PAT);
    console.log('[auth-social]   - BASE_ID set:', !!BASE_ID);
    console.log('[auth-social]   - JWT_SECRET set:', !!JWT_SECRET);

    // Debug: Check context and clientContext
    console.log('[auth-social] Context check:');
    console.log('[auth-social]   - context exists:', !!context);
    console.log('[auth-social]   - clientContext exists:', !!context?.clientContext);
    console.log('[auth-social]   - clientContext.user exists:', !!context?.clientContext?.user);

    if (context?.clientContext?.identity) {
        console.log('[auth-social]   - identity.url:', context.clientContext.identity.url);
    }

    // 1. Verify Netlify Identity User
    const { user } = context.clientContext || {};

    if (!user) {
        console.error('[auth-social] ERROR: No user in clientContext');
        console.error('[auth-social] Full clientContext:', JSON.stringify(context?.clientContext, null, 2));
        return {
            statusCode: 401,
            body: JSON.stringify({
                error: 'Unauthorized - No user context found. Please ensure you are logged in with Netlify Identity.',
                debug: {
                    hasContext: !!context,
                    hasClientContext: !!context?.clientContext,
                    hasUser: false
                }
            })
        };
    }

    console.log('[auth-social] User found in context:');
    console.log('[auth-social]   - email:', user.email);
    console.log('[auth-social]   - app_metadata:', JSON.stringify(user.app_metadata));
    console.log('[auth-social]   - user_metadata:', JSON.stringify(user.user_metadata));

    try {
        const { email, user_metadata } = user;
        const name = user_metadata?.full_name || email.split('@')[0];
        console.log(`[auth-social] Processing social login for email: ${email}, name: ${name}`);

        // 2. Find or Create User in Airtable
        console.log('[auth-social] Step 2: Finding or creating user in Airtable...');
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({${EMAIL_FIELD}}='${email}')`;
        console.log('[auth-social] Airtable lookup URL (masked):', findUserUrl.replace(AIRTABLE_PAT || '', '[REDACTED]'));

        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        console.log('[auth-social] Airtable user lookup response status:', userRes.status);

        if (!userRes.ok) {
            const errorText = await userRes.text();
            console.error('[auth-social] Airtable user lookup failed:', errorText);
            throw new Error(`Airtable user lookup failed: ${userRes.status}`);
        }

        const userData = await userRes.json();
        console.log('[auth-social] User lookup result - records found:', userData.records?.length || 0);

        let userRecord;
        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-social] Found existing user: ${userRecord.id}`);

            // Optional: Update name if it changed in the social provider
            if (userRecord.fields[NAME_FIELD] !== name) {
                console.log(`[auth-social] Updating user name from "${userRecord.fields[NAME_FIELD]}" to "${name}"`);
                await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userRecord.id}`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fields: { [NAME_FIELD]: name } })
                });
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

            console.log('[auth-social] Create user response status:', createUserRes.status);
            if (!createUserRes.ok) {
                const errorText = await createUserRes.text();
                console.error('[auth-social] Failed to create user:', errorText);
                throw new Error('Failed to create user in Airtable via social auth.');
            }

            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-social] Created new user: ${userRecord.id}`);
        }

        // 3. Check for Store Ownership
        console.log('[auth-social] Step 3: Checking store ownership...');
        let ownerData = { isOwner: false, ownerDashboardId: null, ownedStoreId: null };
        if (userRecord.fields[OWNED_STORE_FIELD] && userRecord.fields[OWNED_STORE_FIELD].length > 0) {
            const storeId = userRecord.fields[OWNED_STORE_FIELD][0];
            console.log(`[auth-social] User has owned store: ${storeId}`);

            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}?fields[]=${encodeURIComponent(OWNER_DASHBOARD_ID_FIELD)}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields[OWNER_DASHBOARD_ID_FIELD]) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields[OWNER_DASHBOARD_ID_FIELD];
                    ownerData.ownedStoreId = storeId;
                    console.log(`[auth-social] User ${userRecord.id} is owner. Dashboard ID: ${ownerData.ownerDashboardId}`);
                }
            } else {
                console.warn(`[auth-social] Could not fetch owned store details for store ID: ${storeId}`);
            }
        } else {
            console.log('[auth-social] User does not own any stores');
        }

        // 4. Fetch Associated Session Names
        console.log('[auth-social] Step 4: Fetching associated sessions...');
        let associatedSessions = [];
        const sessionIds = userRecord.fields[ASSOCIATED_SESSIONS_FIELD];
        if (sessionIds && sessionIds.length > 0) {
            console.log(`[auth-social] Found ${sessionIds.length} associated session IDs`);
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}?fields[]=${encodeURIComponent(NAME_FIELD)}&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({ id: rec.id, name: rec.fields[NAME_FIELD] || 'Unnamed Session' }));
                console.log(`[auth-social] Found ${associatedSessions.length} associated sessions for user ${userRecord.id}`);
            } else {
                console.warn(`[auth-social] Could not fetch associated sessions. Status: ${sessionsRes.status}`);
            }
        } else {
            console.log('[auth-social] No associated sessions found');
        }

        // 5. Fetch Liked Item IDs
        console.log('[auth-social] Step 5: Fetching liked items...');
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;

        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-social] Found ${likedItemIds.length} liked items`);
        } else {
            console.warn(`[auth-social] Failed to fetch liked items. Status: ${likedItemsRes.status}`);
        }

        // 6. Fetch RSVP'd Item IDs (Events)
        console.log('[auth-social] Step 6: Fetching RSVP\'d items...');
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;

        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-social] Found ${rsvpdItemIds.length} RSVP'd items`);
        } else {
            console.warn(`[auth-social] Failed to fetch RSVP'd items. Status: ${rsvpdItemsRes.status}`);
        }

        // 7. Generate Session JWT
        console.log('[auth-social] Step 7: Generating JWT...');
        const sessionToken = jwt.sign(
            {
                userId: userRecord.id,
                name: userRecord.fields[NAME_FIELD],
                email: userRecord.fields[EMAIL_FIELD],
                isOwner: ownerData.isOwner
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        console.log('[auth-social] JWT generated successfully');

        // 8. Build and Return Response
        const responsePayload = {
            token: sessionToken,
            user: {
                id: userRecord.id,
                name: userRecord.fields[NAME_FIELD],
                email: userRecord.fields[EMAIL_FIELD],
                phoneNumber: userRecord.fields.PhoneNumber || '',
                notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                associatedSessions: associatedSessions,
                likedItemIds: likedItemIds,
                rsvpdItemIds: rsvpdItemIds
            },
            ownerData: ownerData
        };

        console.log('[auth-social] Response payload summary:');
        console.log('[auth-social]   - user.id:', responsePayload.user.id);
        console.log('[auth-social]   - user.email:', responsePayload.user.email);
        console.log('[auth-social]   - likedItemIds count:', responsePayload.user.likedItemIds.length);
        console.log('[auth-social]   - rsvpdItemIds count:', responsePayload.user.rsvpdItemIds.length);
        console.log('[auth-social]   - associatedSessions count:', responsePayload.user.associatedSessions.length);
        console.log('[auth-social]   - isOwner:', responsePayload.ownerData.isOwner);
        console.log('[auth-social] ========== FUNCTION SUCCESS ==========');

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(responsePayload),
        };
    } catch (error) {
        console.error('[auth-social] ========== FUNCTION ERROR ==========');
        console.error('[auth-social] Error message:', error.message);
        console.error('[auth-social] Error stack:', error.stack);
        console.error('[auth-social] ========== END ERROR ==========');

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: error.message || 'An internal server error occurred.',
                debug: {
                    timestamp: new Date().toISOString()
                }
            })
        };
    }
};
