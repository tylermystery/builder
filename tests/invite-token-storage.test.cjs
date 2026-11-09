const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Emulate Lambda's per-request Blobs context without live storage or email.
function tokenHandler(name, records) {
  let invocation;
  let connected;
  const context = vm.createContext({
    exports: {},
    console: { log() {}, error() {} },
    require(module) {
      if (module === 'crypto') return require('node:crypto');
      assert.equal(module, '@netlify/blobs');
      return {
        connectLambda(event) {
          assert.equal(event, invocation);
          connected = event;
        },
        getStore(options) {
          assert.equal(connected, invocation, 'initialize storage for every invocation');
          assert.equal(options.name, 'invite-tokens');
          assert.equal(options.consistency, 'strong');
          return {
            async setJSON(key, value) { records.set(key, structuredClone(value)); },
            async get(key) { return structuredClone(records.get(key) || null); }
          };
        }
      };
    }
  });
  vm.runInContext(fs.readFileSync(`netlify/functions/${name}.js`, 'utf8'), context);
  return async body => {
    invocation = { httpMethod: 'POST', body: JSON.stringify(body), blobs: 'test-context' };
    connected = undefined;
    return context.exports.handler(invocation);
  };
}

test('invite links initialize Lambda storage on creation and acceptance, preserve data, and reject reuse', async () => {
  const records = new Map();
  const create = tokenHandler('generate-invite-token', records);
  const validate = tokenHandler('validate-invite-token', records);
  const result = await create({ sessionId: 'recPlan', email: 'invitee@example.test', role: 'viewer', inviterName: 'Owner' });
  assert.equal(result.statusCode, 200);
  const { token } = JSON.parse(result.body);
  assert.match(token, /^[a-f0-9]{64}$/);
  const accepted = await validate({ token });
  assert.equal(accepted.statusCode, 200);
  const data = JSON.parse(accepted.body);
  assert.equal(data.sessionId, 'recPlan');
  assert.equal(data.role, 'viewer');
  assert.equal(data.inviterName, 'Owner');
  assert.equal(records.get(token).consumed, true);
  assert.equal((await validate({ token })).statusCode, 410);
  assert.equal((await validate({ token: 'unknown' })).statusCode, 404);
});

test('expired invitations remain rejected after initializing storage', async () => {
  const records = new Map([['expired', { expiresAt: '2000-01-01T00:00:00Z', consumed: false }]]);
  const validate = tokenHandler('validate-invite-token', records);
  assert.equal((await validate({ token: 'expired' })).statusCode, 410);
  assert.equal(records.get('expired').consumed, false);
});
