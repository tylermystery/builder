// Collab summary: one sentiment summary from any number of reaction sources.
//
// Every collab-able thing (an item, a variant, a chat message, a comment) is summed
// up the same way: each person's reactions are averaged on the sentiment scale,
// then everyone is weighted equally. When an item has both plan reactions (its
// collaborators) and community reactions (the whole store), they are combined:
// one person's reactions in both places count once, as one voice.
import { computeDemocraticAverage, scoreToAdjective, EMOJI_REACTIONS } from '../config.js';

/** Collab reactions: the scored set, used everywhere. */
export const COLLAB_REACTIONS = EMOJI_REACTIONS;

/**
 * Merge reaction sources into one Map<userId, Set<emoji>>.
 * @param {...Map} maps
 */
export function mergeReactionMaps(...maps) {
    const merged = new Map();
    for (const map of maps) {
        if (!(map instanceof Map)) continue;
        for (const [userId, data] of map) {
            const set = data instanceof Set ? data : (Array.isArray(data) ? new Set(data) : new Set(data ? [data] : []));
            if (set.size === 0) continue;
            if (!merged.has(userId)) merged.set(userId, new Set());
            for (const emoji of set) merged.get(userId).add(emoji);
        }
    }
    return merged;
}

/** { emoji: [userIds] } (chat messages) -> Map<userId, Set<emoji>> */
export function emojiUsersToMap(reactions) {
    const map = new Map();
    for (const [emoji, users] of Object.entries(reactions || {})) {
        for (const userId of Array.isArray(users) ? users : []) {
            if (!map.has(userId)) map.set(userId, new Set());
            map.get(userId).add(emoji);
        }
    }
    return map;
}

/**
 * @param {Map<string, Set<string>>} userMap
 * @returns {{ has: boolean, emoji: string, score: number, label: string, people: number,
 *             total: number, counts: Record<string, number> }}
 */
export function summarizeReactions(userMap) {
    const counts = {};
    let total = 0;
    for (const set of (userMap instanceof Map ? userMap.values() : [])) {
        for (const emoji of set) { counts[emoji] = (counts[emoji] || 0) + 1; total++; }
    }
    const { democraticAverage, summaryEmoji, userCount } = computeDemocraticAverage(userMap instanceof Map ? userMap : new Map());
    return {
        has: total > 0,
        emoji: total > 0 ? summaryEmoji : '',
        score: democraticAverage,
        label: total > 0 ? scoreToAdjective(democraticAverage) : 'No reactions yet',
        people: userCount,
        total,
        counts
    };
}
