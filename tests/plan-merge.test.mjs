import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessionData, describePlanChanges, safeClone } from '../utils/planMerge.js';

const plan = (over = {}) => ({
  ideasItems: {}, lockedInItems: { recA: { quantity: 1 }, recB: { quantity: 1 }, recC: { quantity: 1 } },
  eventDetails: { eventName: 'Party' }, itemReactions: {}, archivedItems: [], completedItems: [],
  goalItems: [], planItemOrder: ['recA', 'recB', 'recC'], ...over,
});

test('a dormant device saving an unrelated change does not revert items moved to Ideas elsewhere', () => {
  const base = plan();
  // Active device moved A and B to Ideas.
  const remote = plan({ ideasItems: { recA: { quantity: 1 }, recB: { quantity: 1 } }, lockedInItems: { recC: { quantity: 1 } } });
  // Dormant device (still on the old copy) only reacted to C.
  const local = plan({ itemReactions: { recC: { u2: ['🔥'] } } });
  const { merged, remoteChanged, localChanged } = mergeSessionData(base, local, remote);
  assert.deepEqual(Object.keys(merged.ideasItems).sort(), ['recA', 'recB']);
  assert.deepEqual(Object.keys(merged.lockedInItems), ['recC']);
  assert.deepEqual(merged.itemReactions, { recC: { u2: ['🔥'] } });
  assert.equal(remoteChanged, true);
  assert.equal(localChanged, true);
});

test('both devices changing different things keeps both; same value changed on both: this save wins', () => {
  const base = plan();
  const remote = plan({ eventDetails: { eventName: 'Party', guestCount: 12 }, completedItems: ['recA'] });
  const local = plan({ eventDetails: { eventName: 'Big Party' }, completedItems: ['recB'] });
  const { merged } = mergeSessionData(base, local, remote);
  assert.deepEqual(merged.eventDetails, { eventName: 'Big Party', guestCount: 12 });
  assert.deepEqual(merged.completedItems.sort(), ['recA', 'recB']);
});

test('an item never ends up in both Ideas and the plan', () => {
  const base = plan();
  // Remote moved A to Ideas; local changed A's quantity while still in the plan.
  const remote = plan({ ideasItems: { recA: { quantity: 1 } }, lockedInItems: { recB: { quantity: 1 }, recC: { quantity: 1 } } });
  const local = plan({ lockedInItems: { recA: { quantity: 3 }, recB: { quantity: 1 }, recC: { quantity: 1 } } });
  const { merged } = mergeSessionData(base, local, remote);
  assert.equal('recA' in merged.lockedInItems && 'recA' in merged.ideasItems, false);
  assert.equal(merged.lockedInItems.recA.quantity, 3); // this device's change is the latest
});

test('reactions from different people on the same item are both kept', () => {
  const base = plan();
  const remote = plan({ itemReactions: { recA: { u1: ['❤️'] } } });
  const local = plan({ itemReactions: { recA: { u2: ['🔥'] } } });
  const { merged } = mergeSessionData(base, local, remote);
  assert.deepEqual(merged.itemReactions.recA, { u1: ['❤️'], u2: ['🔥'] });
});

test('order keeps this device\'s arrangement and folds in items added or removed elsewhere', () => {
  const base = plan();
  const remote = plan({ planItemOrder: ['recA', 'recC', 'recD'] }); // removed B, added D
  const local = plan({ planItemOrder: ['recC', 'recB', 'recA'] });
  const { merged } = mergeSessionData(base, local, remote);
  assert.deepEqual(merged.planItemOrder, ['recC', 'recA', 'recD']);
});

test('no remote change leaves this save as-is; editors are unioned', () => {
  const base = plan({ planActivity: { createdBy: 'u1', editors: ['u1'], lastEditedAt: '2026-01-01T00:00:00Z' } });
  const remote = safeClone(base);
  remote.planActivity.editors = ['u1', 'u3'];
  const local = plan({ archivedItems: ['recB'], planActivity: { createdBy: 'u1', editors: ['u1', 'u2'], lastEditedAt: '2026-02-01T00:00:00Z', lastEditedBy: 'u2' } });
  const { merged } = mergeSessionData(base, local, remote);
  assert.deepEqual(merged.archivedItems, ['recB']);
  assert.deepEqual(merged.planActivity.editors.sort(), ['u1', 'u2', 'u3']);
  assert.equal(merged.planActivity.lastEditedBy, 'u2');
});

test('describes changes in plain language', () => {
  const names = { recA: 'Kayaking', recB: 'Dinner', recN: 'Karaoke' };
  const before = plan({ eventDetails: { eventName: 'Party' } });
  const after = plan({
    ideasItems: { recA: { quantity: 1 } }, lockedInItems: { recB: { quantity: 2 }, recC: { quantity: 1 }, recN: {} },
    completedItems: ['recC'], eventDetails: { eventName: 'Summer Party', guestCount: 8, _resolvedChatThreads: { m1: {} }, _commentTaskLinks: { x: 'y' } },
  });
  const texts = describePlanChanges(before, after, id => names[id] || 'Boat').map(c => c.text);
  assert.ok(texts.includes('Moved “Kayaking” to Ideas'));
  assert.ok(texts.includes('Updated “Dinner”'));
  assert.ok(texts.includes('Added “Karaoke” to the plan'));
  assert.ok(texts.includes('Marked “Boat” complete'));
  assert.ok(texts.includes('Renamed the plan to “Summer Party”'));
  assert.ok(texts.includes('Set the guest count to 8'));
  assert.ok(texts.includes('Resolved a chat'));
  assert.equal(texts.some(t => /commentTaskLinks/.test(t)), false);
});

test('bookkeeping-only changes elsewhere are not treated as plan changes', () => {
  const base = plan({ openConversations: { chats: 1, tasks: 0 } });
  const remote = plan({ openConversations: { chats: 3, tasks: 1 }, planActivity: { editors: ['u9'] }, background: { chatThreads: ['plan'] } });
  const local = plan({ openConversations: { chats: 1, tasks: 0 } });
  const { remoteChanged, localChanged } = mergeSessionData(base, local, remote);
  assert.equal(remoteChanged, false);
  assert.equal(localChanged, false);
});
