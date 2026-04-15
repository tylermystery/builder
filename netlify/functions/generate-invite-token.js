// FILE: netlify/functions/generate-invite-token.js
// Generates a cryptographically random invite token and stores it in Netlify Blobs

const crypto = require('crypto');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { sessionId, email, role, invitedBy, inviterName, sessionName } = JSON.parse(event.body);

        if (!sessionId || !email) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'sessionId and email are required.' })
            };
        }

        // Generate a secure random token
        const token = crypto.randomBytes(32).toString('hex');

        // 7-day expiry
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const tokenData = {
            token,
            sessionId,
            email,
            role: role || 'editor',
            invitedBy: invitedBy || '',
            inviterName: inviterName || '',
            sessionName: sessionName || '',
            createdAt: new Date().toISOString(),
            expiresAt,
            consumed: false
        };

        // Store in Netlify Blobs
        const { getStore } = require('@netlify/blobs');
        const store = getStore({ name: 'invite-tokens', consistency: 'strong' });
        await store.setJSON(token, tokenData);

        console.log(`[generate-invite-token] Token created for ${email} on session ${sessionId}, expires ${expiresAt}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ token })
        };

    } catch (error) {
        console.error('[generate-invite-token] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
