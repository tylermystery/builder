// REPLACE THE ENTIRE CONTENTS OF: netlify/functions/auth-confirm.js

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const Pusher = require("pusher");
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET, PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;

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

        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const tokenData = await tokenRes.json();
        if (!tokenData.records || tokenData.records.length === 0) throw new Error('Invalid or expired token.');
        
        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt, ChannelID } = magicLinkRecord.fields;

        if (new Date() > new Date(ExpiresAt)) throw new Error('Invalid or expired token.');
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=AND({Email}='${Email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        let userData = await userRes.json();
        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
        } else {
            const createUserRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Users`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { Email: Email, Name: Email.split('@')[0] } }] })
            });
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
        }

        let ownerData = { isOwner: false, ownerDashboardId: null };
        if (userRecord.fields.OwnedStore && userRecord.fields.OwnedStore.length > 0) {
            const storeId = userRecord.fields.OwnedStore[0];
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields.OwnerDashboardID) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields.OwnerDashboardID;
                }
            }
        }
        
        // *** NEW LOGIC TO FETCH SESSION NAMES ***
        let associatedSessions = [];
        const sessionIds = userRecord.fields['Associated Sessions'];
        if (sessionIds && sessionIds.length > 0) {
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions?fields%5B%5D=Name&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({ id: rec.id, name: rec.fields.Name }));
            }
        }
        // *** END NEW LOGIC ***

        // Fetch liked items
        let likedItemIds = [];
        const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
        const LIKED_BY_FIELD = 'Liked By Users';
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;
        
        console.log(`[auth-confirm] Fetching liked items for user ${userRecord.id}`);
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-confirm] Found ${likedItemIds.length} liked items`);
        }

        // Fetch RSVP'd items
        let rsvpdItemIds = [];
        const RSVPS_FIELD = 'RSVPs';
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;
        
        console.log(`[auth-confirm] Fetching RSVP'd items for user ${userRecord.id}`);
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
                phoneNumber: userRecord.fields.PhoneNumber || '',
                notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                likedItemIds: likedItemIds,
                rsvpdItemIds: rsvpdItemIds,
                associatedSessions: associatedSessions
            },
            ownerData: ownerData
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html' },
            body: `<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>Authentication Confirmed!</h1><p>You can now return to the original tab to continue.</p></div>`
        };
    } catch (error) {
        console.error('Auth-confirm error:', error);
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'text/html' },
            body: `<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>Authentication Failed</h1><p>${error.message}. Please try again.</p></div>`
        };
    }
};
