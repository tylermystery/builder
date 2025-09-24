const fetch = require('node-fetch');
const Pusher = require("pusher");

const { AIRTABLE_PAT, BASE_ID, PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;

const pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
});

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { messageId, emoji, userId, sessionId } = JSON.parse(event.body);

        // 1. Get the current message record from Airtable
        const getUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${messageId}`;
        const getResponse = await fetch(getUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (!getResponse.ok) throw new Error('Could not fetch message from Airtable.');
        const messageRecord = await getResponse.json();

        // 2. Update the reactions object
        let reactions = {};
        try {
            reactions = JSON.parse(messageRecord.fields.Reactions || '{}');
        } catch (e) { /* Ignore parsing errors, start fresh */ }

        if (!reactions[emoji]) {
            reactions[emoji] = [];
        }

        const userIndex = reactions[emoji].indexOf(userId);
        if (userIndex > -1) {
            // User has already reacted with this emoji, so remove it (toggle off)
            reactions[emoji].splice(userIndex, 1);
            if (reactions[emoji].length === 0) {
                delete reactions[emoji];
            }
        } else {
            // User has not reacted, so add them
            reactions[emoji].push(userId);
        }

        // 3. Save the updated reactions back to Airtable
        const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
        const payload = {
            records: [{
                id: messageId,
                fields: { Reactions: JSON.stringify(reactions) }
            }]
        };
        await fetch(patchUrl, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // 4. Notify all clients via Pusher
        const channelName = `presence-session-${sessionId}`;
        await pusher.trigger(channelName, "reaction-updated", {
            messageId: messageId,
            reactions: reactions
        });

        return { statusCode: 200, body: JSON.stringify(reactions) };

    } catch (error) {
        console.error("Reaction update error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
