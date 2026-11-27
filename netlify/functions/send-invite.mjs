// FILE: netlify/functions/send-invite.mjs
// Current-format function so the invite-token store supports strong consistency
// (tokens are readable the moment an invite is sent).
import { getStore } from '@netlify/blobs';
import inviteModule from './utils/send-invite-core.js';

const json = (statusCode, body) => new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
});

export default async (req) => {
    if (req.method !== 'POST') {
        return json(405, { error: 'Method Not Allowed' });
    }
    const store = getStore({ name: 'invite-tokens', consistency: 'strong' });
    const { statusCode, body } = await inviteModule.sendInvite(store, await req.text());
    return json(statusCode, body);
};
