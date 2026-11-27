const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { generateInviteToken, validateInviteToken } = require('../netlify/functions/utils/invite-tokens');

function memoryStore(records) {
  return {
    async setJSON(key, value) { records.set(key, structuredClone(value)); },
    async get(key) { return structuredClone(records.get(key) || null); }
  };
}

const quiet = fn => async (...args) => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try { return await fn(...args); } finally { console.log = log; console.error = error; }
};

test('invite links preserve data on creation and acceptance, and reject reuse', quiet(async () => {
  const records = new Map();
  const store = memoryStore(records);
  const result = await generateInviteToken(store, JSON.stringify({ sessionId: 'recPlan', email: 'invitee@example.test', role: 'viewer', inviterName: 'Owner' }));
  assert.equal(result.statusCode, 200);
  const { token } = result.body;
  assert.match(token, /^[a-f0-9]{64}$/);
  const accepted = await validateInviteToken(store, JSON.stringify({ token }));
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.sessionId, 'recPlan');
  assert.equal(accepted.body.role, 'viewer');
  assert.equal(accepted.body.inviterName, 'Owner');
  assert.equal(records.get(token).consumed, true);
  assert.equal((await validateInviteToken(store, JSON.stringify({ token }))).statusCode, 410);
  assert.equal((await validateInviteToken(store, JSON.stringify({ token: 'unknown' }))).statusCode, 404);
}));

test('expired invitations remain rejected', quiet(async () => {
  const records = new Map([['expired', { expiresAt: '2000-01-01T00:00:00Z', consumed: false }]]);
  assert.equal((await validateInviteToken(memoryStore(records), JSON.stringify({ token: 'expired' }))).statusCode, 410);
  assert.equal(records.get('expired').consumed, false);
}));

test('invite functions use the current format with a strongly consistent token store', () => {
  for (const name of ['send-invite', 'validate-invite-token', 'generate-invite-token']) {
    const source = fs.readFileSync(`netlify/functions/${name}.mjs`, 'utf8');
    assert.match(source, /export default async/);
    assert.match(source, /getStore\(\{ name: 'invite-tokens', consistency: 'strong' \}\)/);
    assert.doesNotMatch(source, /connectLambda|exports\.handler/);
    assert.ok(!fs.existsSync(`netlify/functions/${name}.js`), `stale Lambda-format ${name}.js must not shadow the new function`);
  }
  const toml = fs.readFileSync('netlify.toml', 'utf8');
  assert.match(toml, /from = "\/api\/validate-invite-token"\s+to = "\/\.netlify\/functions\/validate-invite-token"/);
});
