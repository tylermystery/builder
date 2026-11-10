const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function load(fetchImpl) {
    const original = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'node-fetch') return fetchImpl;
        return original.call(this, request, ...rest);
    };
    try {
        delete require.cache[require.resolve('../netlify/functions/auth-social.js')];
        return require('../netlify/functions/auth-social.js');
    } finally {
        Module._load = original;
    }
}

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('Google sign-in matches an existing account case-insensitively and keeps the chosen name', async () => {
    process.env.AIRTABLE_PAT = 'pat'; process.env.BASE_ID = 'base'; process.env.JWT_SECRET = 'secret';
    const calls = [];
    const { handler } = load(async (url, opts = {}) => {
        calls.push({ url: decodeURIComponent(url), method: opts.method || 'GET' });
        if (url.includes('/Users?')) return ok({ records: [{ id: 'recUser1', fields: { Email: 'Jane@Example.com', Name: 'Janie' } }] });
        return ok({ records: [] });
    });
    const res = await handler({ httpMethod: 'POST', headers: {} },
        { clientContext: { user: { email: ' JANE@example.com ', user_metadata: { full_name: 'Jane Doe' } } } });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.user.id, 'recUser1');
    assert.equal(body.user.name, 'Janie');
    assert.match(calls[0].url, /LOWER\(TRIM\(\{Email\}\)\)="jane@example.com"/);
    assert.equal(calls.some(c => c.method === 'PATCH' || c.method === 'POST'), false); // no rename, no duplicate account
});

test('rejects requests without a verified Identity user', async () => {
    const { handler } = load(async () => ok({ records: [] }));
    const res = await handler({ httpMethod: 'POST', headers: {} }, { clientContext: {} });
    assert.equal(res.statusCode, 401);
});
