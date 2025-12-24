// FILE: netlify/functions/auth-webauthn-register-verify.js
// Verifies WebAuthn registration and stores the credential

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
        const { credential, userId } = JSON.parse(event.body);

        if (!credential || !userId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Credential and userId are required' }) };
        }

        console.log(`[webauthn-register-verify] Verifying registration for user: ${userId}`);

        // Get the origin for RP ID verification
        const origin = event.headers.origin || event.headers.referer || 'https://whatthefunfinder.netlify.app';
        const expectedRpId = new URL(origin).hostname;

        // Find the pending challenge
        const findChallengeUrl = `https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges?filterByFormula=AND({UserId}='${userId}',{Type}='registration')&sort[0][field]=ExpiresAt&sort[0][direction]=desc`;
        const challengeRes = await fetch(findChallengeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const challengeData = await challengeRes.json();

        if (!challengeData.records || challengeData.records.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: 'No pending registration challenge found' }) };
        }

        const challengeRecord = challengeData.records[0];
        const expectedChallenge = challengeRecord.fields.Challenge;

        // Check if challenge is expired
        if (new Date() > new Date(challengeRecord.fields.ExpiresAt)) {
            // Clean up expired challenge
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges/${challengeRecord.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            return { statusCode: 400, body: JSON.stringify({ error: 'Challenge expired' }) };
        }

        // Parse the credential response
        const { id, rawId, response: credentialResponse, type } = credential;

        // Decode the clientDataJSON
        const clientDataJSON = Buffer.from(credentialResponse.clientDataJSON, 'base64');
        const clientData = JSON.parse(clientDataJSON.toString('utf8'));

        // Verify the challenge matches
        // The challenge in clientData is base64url encoded
        if (clientData.challenge !== expectedChallenge) {
            console.error('[webauthn-register-verify] Challenge mismatch');
            return { statusCode: 400, body: JSON.stringify({ error: 'Challenge verification failed' }) };
        }

        // Verify the origin
        const clientOrigin = clientData.origin;
        const clientRpId = new URL(clientOrigin).hostname;
        if (clientRpId !== expectedRpId) {
            console.error(`[webauthn-register-verify] Origin mismatch: expected ${expectedRpId}, got ${clientRpId}`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Origin verification failed' }) };
        }

        // Verify the type is 'webauthn.create'
        if (clientData.type !== 'webauthn.create') {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid credential type' }) };
        }

        // Decode attestation object to extract public key
        const attestationObject = Buffer.from(credentialResponse.attestationObject, 'base64');

        // Parse the CBOR-encoded attestation object (simplified parsing)
        // For production, use a proper CBOR library
        const publicKeyCredential = {
            credentialId: rawId,
            publicKey: credentialResponse.attestationObject, // Store the full attestation object
            counter: 0,
            transports: credential.transports || ['internal']
        };

        // Store the credential in Airtable
        const createPasskeyUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PASSKEYS_TABLE)}`;
        const passkeyRes = await fetch(createPasskeyUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                records: [{
                    fields: {
                        UserId: userId,
                        CredentialId: rawId,
                        PublicKey: credentialResponse.attestationObject,
                        Counter: 0,
                        Transports: JSON.stringify(credential.transports || ['internal']),
                        CreatedAt: new Date().toISOString(),
                        DeviceName: credential.deviceName || 'Unknown Device'
                    }
                }]
            })
        });

        if (!passkeyRes.ok) {
            const errorData = await passkeyRes.json();
            console.error('[webauthn-register-verify] Failed to store passkey:', errorData);
            throw new Error('Failed to store passkey');
        }

        console.log(`[webauthn-register-verify] Passkey stored successfully for user: ${userId}`);

        // Delete the used challenge
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges/${challengeRecord.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        // Fetch user data for login response
        const userUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userId}`;
        const userRes = await fetch(userUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
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
        console.error('[webauthn-register-verify] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
