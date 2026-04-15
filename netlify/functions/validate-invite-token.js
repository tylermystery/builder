// FILE: netlify/functions/validate-invite-token.js
// Validates an invite token from Netlify Blobs, checks expiry, and marks as consumed

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { token } = JSON.parse(event.body);

        if (!token) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Token is required.' })
            };
        }

        const { getStore } = require('@netlify/blobs');
        const store = getStore({ name: 'invite-tokens', consistency: 'strong' });

        const tokenData = await store.get(token, { type: 'json' });

        if (!tokenData) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Invalid or unknown invite link.' })
            };
        }

        // Check if already consumed
        if (tokenData.consumed) {
            return {
                statusCode: 410,
                body: JSON.stringify({ error: 'This invite link has already been used.' })
            };
        }

        // Check expiry
        if (new Date(tokenData.expiresAt) < new Date()) {
            return {
                statusCode: 410,
                body: JSON.stringify({ error: 'This invite link has expired.' })
            };
        }

        // Mark as consumed
        tokenData.consumed = true;
        tokenData.consumedAt = new Date().toISOString();
        await store.setJSON(token, tokenData);

        console.log(`[validate-invite-token] Token consumed for ${tokenData.email} on session ${tokenData.sessionId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                valid: true,
                sessionId: tokenData.sessionId,
                email: tokenData.email,
                role: tokenData.role,
                inviterName: tokenData.inviterName,
                sessionName: tokenData.sessionName
            })
        };

    } catch (error) {
        console.error('[validate-invite-token] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
