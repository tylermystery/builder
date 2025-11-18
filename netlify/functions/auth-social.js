// FILE: netlify/functions/auth-social.js (REPLACE ENTIRE FILE)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// Define table/field names as constants
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID/Name
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Airtable
// --- NEW CONSTANT ---
const RSVPS_FIELD = 'RSVPs'; // Exact field name from Airtable Items table
// --- END NEW CONSTANT ---
const OWNED_STORE_FIELD = 'OwnedStore';
const OWNER_DASHBOARD_ID_FIELD = 'OwnerDashboardID';
const ASSOCIATED_SESSIONS_FIELD = 'Associated Sessions';
const NAME_FIELD = 'Name';
const EMAIL_FIELD = 'Email';

exports.handler = async (event, context) => {
  // 1. Verify Netlify Identity User
  const { user } = context.clientContext;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };
  }

  try {
    const { email, user_metadata } = user;
    const name = user_metadata.full_name || email.split('@')[0]; // Use full name if available
    console.log(`[auth-social] Processing social login for email: ${email}, name: ${name}`);

    // 2. Find or Create User in Airtable
    const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({${EMAIL_FIELD}}='${email}')`;
    const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    const userData = await userRes.json();

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
        if (!createUserRes.ok) throw new Error('Failed to create user in Airtable via social auth.');
        const newUserData = await createUserRes.json();
        userRecord = newUserData.records[0];
        console.log(`[auth-social] Created new user: ${userRecord.id}`);
    }

    // 3. Check for Store Ownership (Copied from auth-verify)
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
                console.log(`[auth-social] User ${userRecord.id} is owner of store ${storeId}. Dashboard ID: ${ownerData.ownerDashboardId}`);
            }
        } else {
             console.warn(`[auth-social] Could not fetch owned store details for store ID: ${storeId}`);
        }
    }

    // 4. Fetch Associated Session Names (Copied from auth-verify)
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

    // --- START NEW LIKES FETCH --- (Copied from auth-verify)
    // 5. Fetch Liked Item IDs
    let likedItemIds = [];
    const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
    const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;

    console.log(`[auth-social] ========== LIKES FETCH DEBUG START ==========`);
    console.log(`[auth-social] User ID: ${userRecord.id}`);
    console.log(`[auth-social] Formula: ${likedItemsFormula}`);
    console.log(`[auth-social] Full URL: ${likedItemsUrl}`);
    console.log(`[auth-social] Fetching liked items for user ${userRecord.id} with formula: ${likedItemsFormula}`);
    const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

    if (likedItemsRes.ok) {
        const likedItemsData = await likedItemsRes.json();
        likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
        console.log(`[auth-social] ✓ Successfully fetched liked items`);
        console.log(`[auth-social] Found ${likedItemIds.length} liked items for user ${userRecord.id}.`);
        console.log(`[auth-social] Liked item IDs:`, likedItemIds);
    } else {
        const errorText = await likedItemsRes.text();
        console.warn(`[auth-social] ✗ Failed to fetch liked items for user ${userRecord.id}. Status: ${likedItemsRes.status}`);
        console.warn(`[auth-social] Error response:`, errorText);
    }
    console.log(`[auth-social] ========== LIKES FETCH DEBUG END ==========`);
    // --- END NEW LIKES FETCH ---

  // In: netlify/functions/auth-social.js (after existing LIKES FETCH block, before JWT generation)

    // --- START NEW RSVPS FETCH (Copied from auth-verify) ---
    // 6. Fetch RSVP'd Item IDs (Events)
    let rsvpdItemIds = [];
    // Formula component: FIND('recUserIdXYZ', ARRAYJOIN({RSVPs})) > 0
    const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
    // We only need the record IDs, so don't request any specific fields.
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
    // --- END NEW RSVPS FETCH ---

    // 7. Generate Session JWT
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

    // 8. Return Response to Client
    console.log(`[auth-social] ========== RESPONSE DEBUG ==========`);
    console.log(`[auth-social] Returning response with ${likedItemIds.length} liked items`);
    console.log(`[auth-social] Liked item IDs being sent to client:`, likedItemIds);
    console.log(`[auth-social] User ID: ${userRecord.id}`);
    console.log(`[auth-social] ========== RESPONSE DEBUG END ==========`);
    return {
        statusCode: 200,
        body: JSON.stringify({
            token: sessionToken,
            user: { 
                id: userRecord.id, 
                name: userRecord.fields[NAME_FIELD], 
                email: userRecord.fields[EMAIL_FIELD],
                phoneNumber: userRecord.fields.PhoneNumber || '',
                notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                likedItemIds: likedItemIds,
                rsvpdItemIds: rsvpdItemIds
            },
            ownerData: ownerData,
            associatedSessions: associatedSessions
        }),
    };
    } catch (error) {
        console.error('[auth-social] Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};
