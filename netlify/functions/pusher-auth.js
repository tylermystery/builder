// In netlify/functions/pusher-auth.js

const Pusher = require("pusher");

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Use URLSearchParams to parse the form data from the event body
    const params = new URLSearchParams(event.body);
    const socketId = params.get('socket_id');
    const channel = params.get('channel_name');

    // The user data is passed directly from the client's auth config
    const presenceData = {
        user_id: params.get('user_id'),
        user_info: {
            name: params.get('user_name'),
            role: params.get('user_role') || 'viewer',
        },
    };

    try {
        const authResponse = pusher.authorizeChannel(socketId, channel, presenceData);
        return {
            statusCode: 200,
            body: JSON.stringify(authResponse),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ msg: 'Pusher authentication failed' }),
        };
    }
};
