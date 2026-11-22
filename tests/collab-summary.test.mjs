import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReactionMaps, summarizeReactions, emojiUsersToMap, COLLAB_REACTIONS } from '../utils/collabSummary.js';

test('plan and community reactions combine; one person counts once', () => {
  const plan = new Map([['u1', new Set(['🔥'])], ['u2', new Set(['👍'])]]);
  const community = new Map([['u1', new Set(['🔥', '🚀'])], ['u3', ['🤢']]]);
  const merged = mergeReactionMaps(plan, community);
  assert.equal(merged.size, 3);
  assert.deepEqual([...merged.get('u1')].sort(), ['🔥', '🚀'].sort()); // 🔥 counted once for u1
  const s = summarizeReactions(merged);
  assert.equal(s.has, true);
  assert.equal(s.people, 3);
  assert.equal(s.total, 4);
  assert.equal(s.counts['🔥'], 1);
  assert.ok(typeof s.emoji === 'string' && s.emoji.length > 0);
});

test('chat message reactions convert, and empty sources summarise as nothing yet', () => {
  const map = emojiUsersToMap({ '👍': ['a', 'b'], '🤔': ['a'] });
  assert.equal(map.get('a').size, 2);
  const empty = summarizeReactions(mergeReactionMaps(new Map(), null));
  assert.equal(empty.has, false);
  assert.equal(empty.emoji, '');
  assert.equal(COLLAB_REACTIONS.length, 8);
});
