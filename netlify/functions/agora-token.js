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

const { RtcTokenBuilder, Role } = require('agora-token/src/RtcTokenBuilder2');

const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';

// Token privilege expiration: 24 hours (in seconds)
const TOKEN_EXPIRY_SECONDS = 86400;

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
        const agoraRole = role === 'host' ? Role.PUBLISHER : Role.SUBSCRIBER;

        // Host must be authenticated (check for userId)
        if (role === 'host' && !userId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Authentication required to start a stream' }),
            };
        }

        // Build token using official Agora AccessToken2 format
        const token = RtcTokenBuilder.buildTokenWithUid(
            AGORA_APP_ID,
            AGORA_APP_CERTIFICATE,
            channelName,
            uid,
            agoraRole,
            TOKEN_EXPIRY_SECONDS,
            TOKEN_EXPIRY_SECONDS
        );

        const expireAt = Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS;

        console.log(`[agora-token] Token generated for channel="${channelName}" role="${role}" uid=${uid}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                token,
                appId: AGORA_APP_ID,
                channel: channelName,
                uid: uid,
                expireAt,
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
