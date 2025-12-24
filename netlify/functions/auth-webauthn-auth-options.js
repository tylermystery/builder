// FILE: netlify/functions/auth-webauthn-auth-options.js
// Generates WebAuthn authentication options for logging in with a passkey

const fetch = require('node-fetch');
const crypto = require('crypto');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const USERS_TABLE = 'Users';
const PASSKEYS_TABLE = 'Passkeys';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { email } = body; // Email is optional for discoverable credentials

        console.log(`[webauthn-auth-options] Generating authentication options${email ? ` for email: ${email}` : ' (discoverable)'}`);

        // Determine the origin/RP ID from the request
        const origin = event.headers.origin || event.headers.referer || 'https://whatthefunfinder.netlify.app';
        const rpId = new URL(origin).hostname;

        console.log(`[webauthn-auth-options] Using RP ID: ${rpId}`);

        let allowCredentials = [];
        let userId = null;

        if (email) {
            // Find user by email
            const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({Email}='${email}')`;
            const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            const userData = await userRes.json();

            if (!userData.records || userData.records.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ error: 'No account found with this email', code: 'USER_NOT_FOUND' }) };
            }

            userId = userData.records[0].id;

            // Find passkeys for this user
            const findPasskeysUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PASSKEYS_TABLE)}?filterByFormula=({UserId}='${userId}')`;
            const passkeysRes = await fetch(findPasskeysUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            const passkeysData = await passkeysRes.json();

            if (!passkeysData.records || passkeysData.records.length === 0) {
                return { statusCode: 404, body: JSON.stringify({ error: 'No passkey found for this account. Please set up biometric login first.', code: 'NO_PASSKEY' }) };
            }

            allowCredentials = passkeysData.records.map(rec => ({
                id: rec.fields.CredentialId,
                type: 'public-key',
                transports: JSON.parse(rec.fields.Transports || '["internal"]')
            }));

            console.log(`[webauthn-auth-options] Found ${allowCredentials.length} passkeys for user ${userId}`);
        }
        // If no email provided, we'll use discoverable credentials (resident keys)

        // Generate a random challenge
        const challenge = crypto.randomBytes(32).toString('base64url');

        // Store the challenge (expires in 5 minutes)
        const challengeExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                records: [{
                    fields: {
                        Challenge: challenge,
                        UserId: userId || 'discoverable',
                        Email: email || '',
                        Type: 'authentication',
                        ExpiresAt: challengeExpiry,
                        RpId: rpId
                    }
                }]
            })
        });

        // Generate WebAuthn authentication options
        const publicKeyCredentialRequestOptions = {
            challenge: challenge,
            rpId: rpId,
            timeout: 60000,
            userVerification: 'preferred',
            allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined
        };

        console.log(`[webauthn-auth-options] Generated authentication options`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                options: publicKeyCredentialRequestOptions,
                userId: userId
            })
        };

    } catch (error) {
        console.error('[webauthn-auth-options] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
