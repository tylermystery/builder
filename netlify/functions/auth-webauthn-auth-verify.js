// FILE: netlify/functions/auth-webauthn-auth-verify.js
// Verifies WebAuthn authentication and logs in the user

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

const USERS_TABLE = 'Users';
const PASSKEYS_TABLE = 'Passkeys';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const RSVPS_FIELD = 'RSVPs';
const SESSIONS_TABLE = 'Sessions';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { credential } = JSON.parse(event.body);

        if (!credential) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Credential is required' }) };
        }

        console.log(`[webauthn-auth-verify] Verifying authentication for credential: ${credential.id.substring(0, 20)}...`);

        // Get the origin for RP ID verification
        const origin = event.headers.origin || event.headers.referer || 'https://whatthefunfinder.netlify.app';
        const expectedRpId = new URL(origin).hostname;

        // Find the passkey by credential ID
        const findPasskeyUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PASSKEYS_TABLE)}?filterByFormula=({CredentialId}='${credential.rawId}')`;
        const passkeyRes = await fetch(findPasskeyUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const passkeyData = await passkeyRes.json();

        if (!passkeyData.records || passkeyData.records.length === 0) {
            console.error('[webauthn-auth-verify] Passkey not found');
            return { statusCode: 401, body: JSON.stringify({ error: 'Passkey not found' }) };
        }

        const passkeyRecord = passkeyData.records[0];
        const userId = passkeyRecord.fields.UserId;
        const storedCounter = passkeyRecord.fields.Counter || 0;

        console.log(`[webauthn-auth-verify] Found passkey for user: ${userId}`);

        // Find the pending challenge
        // Note: Using URL encoding for the filter formula
        const filterFormula = `AND(OR({UserId}='${userId}',{UserId}='discoverable'),{Type}='authentication')`;
        const encodedFilter = encodeURIComponent(filterFormula);
        const findChallengeUrl = `https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges?filterByFormula=${encodedFilter}&sort[0][field]=ExpiresAt&sort[0][direction]=desc`;

        console.log(`[webauthn-auth-verify] Looking for challenge with filter: ${filterFormula}`);

        const challengeRes = await fetch(findChallengeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (!challengeRes.ok) {
            const errorText = await challengeRes.text();
            console.error(`[webauthn-auth-verify] Challenge lookup failed: ${challengeRes.status} - ${errorText}`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Failed to look up challenge' }) };
        }

        const challengeData = await challengeRes.json();
        console.log(`[webauthn-auth-verify] Challenge lookup returned ${challengeData.records?.length || 0} records`);

        if (!challengeData.records || challengeData.records.length === 0) {
            console.error(`[webauthn-auth-verify] No challenge found for userId=${userId}, type=authentication`);
            return { statusCode: 400, body: JSON.stringify({ error: 'No pending authentication challenge found' }) };
        }

        const challengeRecord = challengeData.records[0];
        const expectedChallenge = challengeRecord.fields.Challenge;

        // Check if challenge is expired (ExpiresAt is stored as Unix timestamp in seconds)
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (currentTimestamp > challengeRecord.fields.ExpiresAt) {
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges/${challengeRecord.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            return { statusCode: 400, body: JSON.stringify({ error: 'Challenge expired' }) };
        }

        // Parse the credential response
        const { response: credentialResponse } = credential;

        // Decode the clientDataJSON
        const clientDataJSON = Buffer.from(credentialResponse.clientDataJSON, 'base64');
        const clientData = JSON.parse(clientDataJSON.toString('utf8'));

        // Verify the challenge matches
        if (clientData.challenge !== expectedChallenge) {
            console.error('[webauthn-auth-verify] Challenge mismatch');
            return { statusCode: 400, body: JSON.stringify({ error: 'Challenge verification failed' }) };
        }

        // Verify the origin
        const clientOrigin = clientData.origin;
        const clientRpId = new URL(clientOrigin).hostname;
        if (clientRpId !== expectedRpId) {
            console.error(`[webauthn-auth-verify] Origin mismatch: expected ${expectedRpId}, got ${clientRpId}`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Origin verification failed' }) };
        }

        // Verify the type is 'webauthn.get'
        if (clientData.type !== 'webauthn.get') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid credential type' }) };
        }

        // Decode authenticator data to get the counter
        const authenticatorData = Buffer.from(credentialResponse.authenticatorData, 'base64');
        // Counter is 4 bytes starting at byte 33 (after rpIdHash[32] and flags[1])
        const counter = authenticatorData.readUInt32BE(33);

        console.log(`[webauthn-auth-verify] Counter check: stored=${storedCounter}, received=${counter}`);

        // Verify counter is greater than or equal to stored counter (replay protection)
        // Note: Some authenticators (especially platform authenticators like Windows Hello, Touch ID)
        // may not properly implement counter incrementing, or may always return 0.
        // Per WebAuthn spec, counters are optional and a counter of 0 is valid.
        // We allow:
        // 1. Counter >= storedCounter (normal case, allows first use and same-counter authenticators)
        // 2. Counter == 0 is always accepted if storedCounter is 0 (first use)
        // For maximum security, you could require strictly greater, but this breaks many authenticators.
        if (counter < storedCounter) {
            console.error(`[webauthn-auth-verify] Counter replay detected: stored=${storedCounter}, received=${counter}`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Potential replay attack detected' }) };
        }

        // Update the counter in the database
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PASSKEYS_TABLE)}/${passkeyRecord.id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fields: {
                    Counter: counter,
                    LastUsed: new Date().toISOString()
                }
            })
        });

        // Delete the used challenge
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges/${challengeRecord.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        console.log(`[webauthn-auth-verify] Authentication successful for user: ${userId}`);

        // Fetch user data
        const userUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userId}`;
        const userRes = await fetch(userUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (!userRes.ok) {
            throw new Error('Failed to fetch user data');
        }

        const userRecord = await userRes.json();

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
            }
        }

        // Fetch liked items
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userId}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
        }

        // Fetch RSVP'd items
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userId}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;
        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
        }

        // Generate JWT
        const sessionToken = jwt.sign(
            { userId: userId, name: userRecord.fields.Name, email: userRecord.fields.Email, isOwner: ownerData.isOwner },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                token: sessionToken,
                user: {
                    id: userId,
                    name: userRecord.fields.Name,
                    email: userRecord.fields.Email,
                    phoneNumber: userRecord.fields.Phone || '',
                    notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                    likedItemIds: likedItemIds,
                    rsvpdItemIds: rsvpdItemIds,
                    associatedSessions: associatedSessions
                },
                ownerData: ownerData
            })
        };

    } catch (error) {
        console.error('[webauthn-auth-verify] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
