// FILE: netlify/functions/viewer-chat.js
// v3.8 Phase 6: Server-side relay for viewer chat messages, reactions, and state sync.
// Viewers are unauthenticated and cannot trigger Pusher client events directly.
// This function accepts POST requests and broadcasts to a public Pusher channel
// (`stream-{sessionId}`) so all viewers receive updates, and also relays to the
// host's presence channel (`presence-session-{sessionId}`).

const Pusher = require("pusher");

const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;

let pusher = null;
if (PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER) {
    pusher = new Pusher({
        appId: PUSHER_APP_ID,
        key: PUSHER_KEY,
        secret: PUSHER_SECRET,
        cluster: PUSHER_CLUSTER,
        useTLS: true,
    });
}

// Simple in-memory rate limiting (per function invocation — resets on cold start)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 1000; // 1 message per second per IP
const REACTION_COOLDOWN_MS = 500;  // reactions can be slightly faster

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    if (!pusher) {
        console.warn('[viewer-chat] Pusher not configured');
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'Real-time service not available' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { sessionId, senderName, content, type } = body;

        if (!sessionId || !content) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId and content are required' }) };
        }

        // Rate limiting
        const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
        const rateLimitKey = `${clientIp}:${type || 'message'}`;
        const now = Date.now();
        const lastSent = rateLimitMap.get(rateLimitKey) || 0;
        const cooldown = type === 'reaction' ? REACTION_COOLDOWN_MS : RATE_LIMIT_WINDOW_MS;

        if (now - lastSent < cooldown) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests. Please slow down.' }) };
        }
        rateLimitMap.set(rateLimitKey, now);

        // Clean old rate limit entries periodically
        if (rateLimitMap.size > 1000) {
            for (const [key, time] of rateLimitMap) {
                if (now - time > 60000) rateLimitMap.delete(key);
            }
        }

        const safeName = (senderName || 'Viewer').substring(0, 30);
        const safeContent = content.substring(0, 500);
        const timestamp = new Date().toISOString();

        const publicChannel = `stream-${sessionId}`;
        const presenceChannel = `presence-session-${sessionId}`;

        if (type === 'reaction') {
            // Broadcast reaction to public channel (viewers) and presence channel (host)
            const payload = { emoji: safeContent, senderName: safeName, timestamp };

            await Promise.all([
                pusher.trigger(publicChannel, 'viewer-reaction', payload),
                pusher.trigger(presenceChannel, 'viewer-reaction', payload),
            ]);

            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'reaction' }) };
        }

        if (type === 'caption') {
            // Host-originated caption broadcast to public channel for viewers
            const payload = { text: safeContent, isFinal: body.isFinal || false, timestamp };
            await pusher.trigger(publicChannel, 'stream-caption', payload);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'caption' }) };
        }

        if (type === 'state-update') {
            // Host-originated state update (focus item, etc.) to public channel
            const payload = { focusItemName: safeContent, timestamp };
            await pusher.trigger(publicChannel, 'stream-state-update', payload);
            return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'state-update' }) };
        }

        // Default: chat message
        const payload = {
            senderName: safeName,
            content: safeContent,
            timestamp,
            isViewer: true,
        };

        await Promise.all([
            pusher.trigger(publicChannel, 'viewer-message', payload),
            pusher.trigger(presenceChannel, 'viewer-message', payload),
        ]);

        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, type: 'message' }) };

    } catch (error) {
        console.error('[viewer-chat] Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
