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

        // 1. Find and validate the magic link token
        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const tokenData = await tokenRes.json();
        if (!tokenData.records || tokenData.records.length === 0) throw new Error('Invalid or expired token.');
        
        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt, ChannelID } = magicLinkRecord.fields;

        if (new Date() > new Date(ExpiresAt)) throw new Error('Invalid or expired token.');

        // 2. Delete the used token
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        // 3. Find or create the user
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

        // 4. --- THIS IS THE NEW LOGIC ---
        // Check if the user is a store owner by looking at the 'OwnedStore' field.
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

        // 5. Generate the session JWT, now including the user's name
        const sessionToken = jwt.sign(
            { userId: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email, isOwner: ownerData.isOwner }, 
            JWT_SECRET, 
            { expiresIn: '30d' }
        );

        // 6. Send the JWT AND the new ownerData to the original tab via Pusher
        await pusher.trigger(`private-auth-${ChannelID}`, "auth-success", {
            token: sessionToken,
            user: { id: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email },
            ownerData: ownerData // <-- Now including owner data
        });

        // 7. Return a friendly message to the user
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
