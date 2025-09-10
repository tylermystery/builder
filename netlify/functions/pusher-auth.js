const Pusher = require("pusher");

// Make sure to set these as environment variables in your Netlify/Vercel project settings
const pusher = new Pusher({
    appId: process.env.VITE_PUSHER_APP_ID,
    key: process.env.VITE_PUSHER_KEY,
    secret: process.env.VITE_PUSHER_SECRET,
    cluster: process.env.VITE_PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event) => {
    // We only want to handle POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed',
        };
    }

    const data = JSON.parse(event.body);
    const socketId = data.socket_id;
    const channel = data.channel_name;
    const presenceData = {
        user_id: data.user_id,
        user_info: {
            name: data.user_name,
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
            body: 'Pusher authentication failed',
        };
    }
};
