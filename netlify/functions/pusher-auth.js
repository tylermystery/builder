// In netlify/functions/pusher-auth.js

const Pusher = require("pusher");

exports.handler = async (event) => {
    console.log('[DEBUG] pusher-auth called');

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Check if Pusher credentials are configured
    if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
        console.error('[DEBUG] Pusher environment variables not configured');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Pusher not configured' })
        };
    }

    const pusher = new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.PUSHER_CLUSTER,
        useTLS: true,
    });

    // Use URLSearchParams to parse the form data from the event body
    const params = new URLSearchParams(event.body);
    const socketId = params.get('socket_id');
    const channel = params.get('channel_name');

    if (!socketId || !channel) {
        console.error('[DEBUG] Missing socket_id or channel_name');
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing required parameters' })
        };
    }

    // The user data is passed directly from the client's auth config
    const presenceData = {
        user_id: params.get('user_id') || 'anonymous',
        user_info: {
            name: params.get('user_name') || 'Guest',
        },
    };

    try {
        const authResponse = pusher.authorizeChannel(socketId, channel, presenceData);
        console.log('[DEBUG] Pusher auth successful for channel:', channel);
        return {
            statusCode: 200,
            body: JSON.stringify(authResponse),
        };
    } catch (error) {
        console.error('[DEBUG] Pusher authentication error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Pusher authentication failed', message: error.message }),
        };
    }
};
