// FILE: netlify/functions/auth-confirm.js
// Confirms magic link authentication and logs in the user via Pusher

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const Pusher = require("pusher");
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET, PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;

// Define table/field names as constants for consistency
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const RSVPS_FIELD = 'RSVPs';

const pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event) => {
    try {
        const { token } = event.queryStringParameters;
        if (!token) throw new Error('Token is required.');

        console.log('[auth-confirm] Processing magic link confirmation');

        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const tokenData = await tokenRes.json();
        if (!tokenData.records || tokenData.records.length === 0) throw new Error('Invalid or expired token.');

        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt, ChannelID } = magicLinkRecord.fields;

        if (new Date() > new Date(ExpiresAt)) throw new Error('Invalid or expired token.');
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=AND({Email}='${Email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        let userData = await userRes.json();
        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-confirm] Found existing user: ${userRecord.id}`);
        } else {
            console.log(`[auth-confirm] Creating new user for email: ${Email}`);
            const createUserRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { Email: Email, Name: Email.split('@')[0] } }] })
            });
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-confirm] Created new user: ${userRecord.id}`);
        }

        // Fetch owner data
        let ownerData = { isOwner: false, ownerDashboardId: null, ownedStoreId: null };
        if (userRecord.fields.OwnedStore && userRecord.fields.OwnedStore.length > 0) {
            const storeId = userRecord.fields.OwnedStore[0];
            ownerData.ownedStoreId = storeId;
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields.OwnerDashboardID) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields.OwnerDashboardID;
                    console.log(`[auth-confirm] User ${userRecord.id} is owner of store ${storeId}`);
                }
            }
        }

        // Fetch associated sessions
        let associatedSessions = [];
        const sessionIds = userRecord.fields['Associated Sessions'];
        if (sessionIds && sessionIds.length > 0) {
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}?fields[]=Name&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({ id: rec.id, name: rec.fields.Name || 'Unnamed Session' }));
                console.log(`[auth-confirm] Found ${associatedSessions.length} associated sessions`);
            }
        }

        // Fetch liked items
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-confirm] Found ${likedItemIds.length} liked items`);
        }

        // Fetch RSVP'd items
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;
        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-confirm] Found ${rsvpdItemIds.length} RSVP'd items`);
        }

        const sessionToken = jwt.sign(
            { userId: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email, isOwner: ownerData.isOwner },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        await pusher.trigger(`private-auth-${ChannelID}`, "auth-success", {
            token: sessionToken,
            user: {
                id: userRecord.id,
                name: userRecord.fields.Name,
                email: userRecord.fields.Email,
                phoneNumber: userRecord.fields.Phone || '',
                notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                likedItemIds: likedItemIds,
                rsvpdItemIds: rsvpdItemIds,
                associatedSessions: associatedSessions
            },
            ownerData: ownerData
        });

        console.log(`[auth-confirm] Authentication successful for user: ${userRecord.id}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html' },
            body: `<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>Authentication Confirmed!</h1><p>You can now return to the original tab to continue.</p></div>`
        };
    } catch (error) {
        console.error('[auth-confirm] Error:', error);
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'text/html' },
            body: `<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>Authentication Failed</h1><p>${error.message}. Please try again.</p></div>`
        };
    }
};
