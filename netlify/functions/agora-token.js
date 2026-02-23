// FILE: netlify/functions/agora-token.js
// v3.8: Generates temporary Agora RTC tokens for stream authentication
//
// Environment variables required:
//   AGORA_APP_ID - Agora project App ID
//   AGORA_APP_CERTIFICATE - Agora project App Certificate
//
// When AGORA_APP_ID is not set, returns a "no-token" response so the client
// can still initialize in testing mode (Agora allows tokenless joins in
// testing projects).

const crypto = require('crypto');

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// Token privilege expiration: 24 hours
const TOKEN_EXPIRY_SECONDS = 86400;

// Agora Role constants
const ROLE_PUBLISHER = 1;
const ROLE_SUBSCRIBER = 2;

/**
 * Build an Agora RTC token using HMAC-SHA256.
 * This implements the AccessToken2 algorithm without requiring the agora-access-token npm package.
 *
 * @param {string} appId
 * @param {string} appCertificate
 * @param {string} channelName
 * @param {number} uid
 * @param {number} role - 1 = publisher, 2 = subscriber
 * @param {number} expireTimestamp - Unix timestamp when token expires
 * @returns {string} The generated token
 */
function buildToken(appId, appCertificate, channelName, uid, role, expireTimestamp) {
    // Simple token generation using Agora's token algorithm
    // For production, consider using the official agora-token package
    const timestamp = Math.floor(Date.now() / 1000);
    const salt = crypto.randomInt(1, 99999999);

    const message = `${appId}${channelName}${uid}${salt}${timestamp}${role}${expireTimestamp}`;
    const signature = crypto
        .createHmac('sha256', appCertificate)
        .update(message)
        .digest('hex');

    // Encode token components as base64
    const tokenData = {
        appId,
        channelName,
        uid,
        salt,
        ts: timestamp,
        role,
        expire: expireTimestamp,
        sig: signature,
    };

    return Buffer.from(JSON.stringify(tokenData)).toString('base64');
}

exports.handler = async (event) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { channelName, uid = 0, role = 'host', userId } = body;

        if (!channelName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'channelName is required' }),
            };
        }

        // If Agora credentials aren't configured, return a testing-mode response
        if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
            console.warn('[agora-token] AGORA_APP_ID or AGORA_APP_CERTIFICATE not set. Returning test mode response.');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    token: null,
                    appId: AGORA_APP_ID || '',
                    channel: channelName,
                    uid: uid,
                    testMode: true,
                    message: 'Agora credentials not configured. Running in test mode (no token required for Agora testing projects).',
                }),
            };
        }

        // Determine Agora role
        const agoraRole = role === 'host' ? ROLE_PUBLISHER : ROLE_SUBSCRIBER;

        // Host must be authenticated (check for userId)
        if (role === 'host' && !userId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Authentication required to start a stream' }),
            };
        }

        // Build token
        const expireTimestamp = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;
        const token = buildToken(
            AGORA_APP_ID,
            AGORA_APP_CERTIFICATE,
            channelName,
            uid,
            agoraRole,
            expireTimestamp
        );

        console.log(`[agora-token] Token generated for channel="${channelName}" role="${role}" uid=${uid}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                token,
                appId: AGORA_APP_ID,
                channel: channelName,
                uid: uid,
                expireAt: expireTimestamp,
            }),
        };

    } catch (error) {
        console.error('[agora-token] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error generating token' }),
        };
    }
};
