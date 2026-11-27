// FILE: netlify/functions/validate-invite-token.js
// Current-format function (ESM syntax in a .js file so the bundler also packages the
// npm modules the shared CommonJS helpers require) so the invite-token store supports strong consistency
// (tokens are readable the moment an invite is sent).
import { getStore } from '@netlify/blobs';
import inviteModule from './utils/invite-tokens.js';

const json = (statusCode, body) => new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
});

export default async (req) => {
    if (req.method !== 'POST') {
        return json(405, { error: 'Method Not Allowed' });
    }
    const store = getStore({ name: 'invite-tokens', consistency: 'strong' });
    const { statusCode, body } = await inviteModule.validateInviteToken(store, await req.text());
    return json(statusCode, body);
};
