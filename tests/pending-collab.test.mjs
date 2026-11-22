import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };

const sent = [];
const apiStub = {
  togglePublicReaction: async (...a) => { sent.push(['reaction', ...a]); return { reacted: true }; },
  addPublicComment: async (...a) => { sent.push(['comment', ...a]); return a[1] === 'fail' ? null : { id: 1 }; },
};
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, n) { if (s.endsWith('/api.js')) return { url: 'stub:api', shortCircuit: true }; return n(s, c); }
export async function load(u, c, n) { if (u === 'stub:api') return { format: 'module', source: 'export const togglePublicReaction=(...a)=>globalThis.__api.togglePublicReaction(...a); export const addPublicComment=(...a)=>globalThis.__api.addPublicComment(...a);', shortCircuit: true }; return n(u, c); }
`));
globalThis.__api = apiStub;
const m = await import('../utils/pendingCollab.js');

test('signed-out reactions toggle locally; comments are held; all are sent on sign-in', async () => {
  assert.equal(m.togglePendingReaction(5, '🔥'), true);
  assert.equal(m.togglePendingReaction(5, '🔥'), false);     // tapping again removes it
  m.togglePendingReaction(5, '❤️');
  m.togglePendingReaction(null, '👍', null, { catalogItemId: 'recA', storeId: 'recS' });
  m.queuePendingComment(5, 'Love this idea');
  m.queuePendingComment(5, 'fail');
  assert.equal(m.pendingCollabCount(), 4);
  const result = await m.flushPendingCollab('Ann');
  assert.deepEqual(result, { sent: 3, failed: 1 });
  const reactions = sent.filter(s => s[0] === 'reaction');
  assert.equal(reactions.length, 2);
  assert.equal(reactions.every(r => r[4].ensure === true), true); // only ever adds
  assert.deepEqual(sent.find(s => s[0] === 'comment').slice(1, 3), [5, 'Love this idea']);
  assert.equal(m.pendingCollabCount(), 1); // the failed comment is kept for next time
});
