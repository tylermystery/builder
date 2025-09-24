const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { token } = JSON.parse(event.body);
        if (!token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Token is required.' }) };
        }

        // 1. Find and validate the magic link token
        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const tokenData = await tokenRes.json();
        if (!tokenData.records || tokenData.records.length === 0) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token.' }) };
        }
        
        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt } = magicLinkRecord.fields;

        if (new Date() > new Date(ExpiresAt)) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token.' }) };
        }

        // 2. Delete the used magic link token
        const deleteTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`;
        await fetch(deleteTokenUrl, { method: 'DELETE', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        // 3. Find or create the user
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=AND({Email}='${Email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        let userData = await userRes.json();
        let userRecord;
        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
        } else {
            const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users`;
            const createUserRes = await fetch(createUserUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { Email: Email, Name: Email.split('@')[0] } }] })
            });
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
        }

        // 4. Check if the user is a store owner
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
        
        // 5. Generate JWT and return response
        const sessionToken = jwt.sign(
            { userId: userRecord.id, email: userRecord.fields.Email, isOwner: ownerData.isOwner },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                token: sessionToken,
                user: { id: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email },
                ownerData: ownerData
            }),
        };
    } catch (error) {
        console.error('Auth-verify error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal error occurred.' }),
        };
    }
};
