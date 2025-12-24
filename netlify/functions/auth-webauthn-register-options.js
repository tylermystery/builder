// FILE: netlify/functions/auth-webauthn-register-options.js
// Generates WebAuthn registration options for setting up a passkey

const fetch = require('node-fetch');
const crypto = require('crypto');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const USERS_TABLE = 'Users';
const PASSKEYS_TABLE = 'Passkeys';

// Relying Party (RP) info - this identifies your application
const RP_NAME = 'WTFun Finder';

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { email } = JSON.parse(event.body);

        if (!email) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
        }

        console.log(`[webauthn-register-options] Starting registration for email: ${email}`);

        // Determine the origin/RP ID from the request
        const origin = event.headers.origin || event.headers.referer || 'https://whatthefunfinder.netlify.app';
        const rpId = new URL(origin).hostname;

        console.log(`[webauthn-register-options] Using RP ID: ${rpId}, Origin: ${origin}`);

        // Find or create user in Airtable
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({Email}='${email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const userData = await userRes.json();

        let userRecord;
        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[webauthn-register-options] Found existing user: ${userRecord.id}`);
        } else {
            // Create new user
            console.log(`[webauthn-register-options] Creating new user for email: ${email}`);
            const createUserRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { Email: email, Name: email.split('@')[0] } }] })
            });
            if (!createUserRes.ok) {
                throw new Error('Failed to create user');
            }
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[webauthn-register-options] Created new user: ${userRecord.id}`);
        }

        // Check for existing passkeys for this user (to exclude them)
        let existingCredentials = [];
        const findPasskeysUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PASSKEYS_TABLE)}?filterByFormula=({UserId}='${userRecord.id}')`;
        const passkeysRes = await fetch(findPasskeysUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (passkeysRes.ok) {
            const passkeysData = await passkeysRes.json();
            existingCredentials = passkeysData.records.map(rec => ({
                id: rec.fields.CredentialId,
                type: 'public-key',
                transports: JSON.parse(rec.fields.Transports || '[]')
            }));
            console.log(`[webauthn-register-options] Found ${existingCredentials.length} existing credentials`);
        }

        // Generate a random challenge
        const challenge = crypto.randomBytes(32).toString('base64url');

        // Store the challenge temporarily (expires in 5 minutes)
        const challengeExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const createChallengeUrl = `https://api.airtable.com/v0/${BASE_ID}/WebAuthnChallenges`;

        console.log(`[webauthn-register-options] Storing challenge for user ${userRecord.id}...`);

        const challengeStoreRes = await fetch(createChallengeUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                records: [{
                    fields: {
                        Challenge: challenge,
                        UserId: userRecord.id,
                        Email: email,
                        Type: 'registration',
                        ExpiresAt: challengeExpiry,
                        RpId: rpId
                    }
                }]
            })
        });

        if (!challengeStoreRes.ok) {
            const errorData = await challengeStoreRes.json();
            console.error('[webauthn-register-options] Failed to store challenge:', errorData);
            throw new Error('Failed to store registration challenge: ' + (errorData.error?.message || JSON.stringify(errorData)));
        }

        const challengeStoreData = await challengeStoreRes.json();
        console.log(`[webauthn-register-options] Challenge stored successfully. Record ID: ${challengeStoreData.records?.[0]?.id}`);

        // Generate WebAuthn registration options
        // Using base64url encoding which is required by WebAuthn
        const userId = Buffer.from(userRecord.id).toString('base64url');

        const publicKeyCredentialCreationOptions = {
            challenge: challenge,
            rp: {
                name: RP_NAME,
                id: rpId
            },
            user: {
                id: userId,
                name: email,
                displayName: userRecord.fields.Name || email.split('@')[0]
            },
            pubKeyCredParams: [
                { alg: -7, type: 'public-key' },   // ES256 (recommended)
                { alg: -257, type: 'public-key' }  // RS256 (fallback)
            ],
            authenticatorSelection: {
                // Prefer platform authenticators (Face ID, Touch ID, Windows Hello)
                authenticatorAttachment: 'platform',
                userVerification: 'preferred',
                residentKey: 'preferred',
                requireResidentKey: false
            },
            timeout: 60000,
            attestation: 'none', // We don't need attestation for this use case
            excludeCredentials: existingCredentials
        };

        console.log(`[webauthn-register-options] Generated registration options for user ${userRecord.id}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                options: publicKeyCredentialCreationOptions,
                userId: userRecord.id
            })
        };

    } catch (error) {
        console.error('[webauthn-register-options] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
};
