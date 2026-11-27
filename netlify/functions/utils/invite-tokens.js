// FILE: netlify/functions/utils/invite-tokens.js
// Shared invite-token logic. Callers pass in the Blobs store so the functions
// own their runtime setup while this logic stays independently testable.

const crypto = require('crypto');

const INVITE_STORE_NAME = 'invite-tokens';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function result(statusCode, body) {
    return { statusCode, body };
}

async function createInviteToken(store, { sessionId, email, role, invitedBy, inviterName, sessionName }) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    await store.setJSON(token, {
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
    });
    return { token, expiresAt };
}

async function generateInviteToken(store, rawBody) {
    try {
        const { sessionId, email, role, invitedBy, inviterName, sessionName } = JSON.parse(rawBody);
        if (!sessionId || !email) {
            return result(400, { error: 'sessionId and email are required.' });
        }
        const { token, expiresAt } = await createInviteToken(store, { sessionId, email, role, invitedBy, inviterName, sessionName });
        console.log(`[generate-invite-token] Token created for ${email} on session ${sessionId}, expires ${expiresAt}`);
        return result(200, { token });
    } catch (error) {
        console.error('[generate-invite-token] Error:', error);
        return result(500, { error: error.message });
    }
}

async function validateInviteToken(store, rawBody) {
    try {
        const { token } = JSON.parse(rawBody);
        if (!token) {
            return result(400, { error: 'Token is required.' });
        }

        const tokenData = await store.get(token, { type: 'json' });
        if (!tokenData) {
            return result(404, { error: 'Invalid or unknown invite link.' });
        }
        if (tokenData.consumed) {
            return result(410, { error: 'This invite link has already been used.' });
        }
        if (new Date(tokenData.expiresAt) < new Date()) {
            return result(410, { error: 'This invite link has expired.' });
        }

        tokenData.consumed = true;
        tokenData.consumedAt = new Date().toISOString();
        await store.setJSON(token, tokenData);

        console.log(`[validate-invite-token] Token consumed for ${tokenData.email} on session ${tokenData.sessionId}`);

        return result(200, {
            valid: true,
            sessionId: tokenData.sessionId,
            email: tokenData.email,
            role: tokenData.role,
            inviterName: tokenData.inviterName,
            sessionName: tokenData.sessionName
        });
    } catch (error) {
        console.error('[validate-invite-token] Error:', error);
        return result(500, { error: error.message });
    }
}

module.exports = { INVITE_STORE_NAME, createInviteToken, generateInviteToken, validateInviteToken };
