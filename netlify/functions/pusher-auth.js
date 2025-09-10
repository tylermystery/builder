const Pusher = require("pusher");

// Make sure to set these as environment variables in your Netlify project settings
const pusher = new Pusher({
    // 👇 REMOVE VITE_ PREFIX FROM THESE FOUR LINES
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
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
