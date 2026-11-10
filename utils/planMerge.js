// Three-way merge for a plan's saved data ("Items with Variations" JSON).
//
//   base   – the plan as this device last loaded or saved it
//   local  – what this device wants to save now
//   remote – what is stored right now (possibly changed by another device)
//
// Only what this device actually changed (local vs base) is applied on top of
// remote, so a dormant tab can no longer revert newer edits it never touched.
// When both sides changed the same value, this save is the most recent change
// and wins.

// Arrays whose order doesn't matter: merged as sets of ids.
const SET_PATHS = new Set([
    'archivedItems', 'completedItems', 'goalItems',
    'background.chatThreads', 'planActivity.editors'
]);
// Ordered id lists: keep this device's order, folding in others' additions/removals.
const ORDERED_ID_PATHS = new Set(['planItemOrder']);
const MAX_DEPTH = 6;

export function safeClone(value) {
    const seen = new WeakSet();
    try {
        return JSON.parse(JSON.stringify(value, (key, v) => {
            if (key === 'parentConceptRecord') return undefined;
            if (v instanceof Set) return Array.from(v);
            if (v instanceof Map) return Object.fromEntries(v);
            if (typeof v === 'object' && v !== null) {
                if (seen.has(v)) return undefined;
                seen.add(v);
            }
            return v;
        }) ?? null);
    } catch {
        return null;
    }
}

export function deepEqual(a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined || a === null || b === null) return a === b;
    if (typeof a !== typeof b || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = v => (Array.isArray(v) ? v : []);

function mergeSet(base, local, remote) {
    const b = new Set(asArray(base).map(String));
    const l = new Set(asArray(local).map(String));
    const out = new Set(asArray(remote).map(String));
    for (const id of l) if (!b.has(id)) out.add(id);        // added here
    for (const id of b) if (!l.has(id)) out.delete(id);     // removed here
    return Array.from(out);
}

function mergeOrdered(base, local, remote) {
    const b = new Set(asArray(base));
    const l = asArray(local);
    const r = asArray(remote);
    const lSet = new Set(l);
    const rSet = new Set(r);
    // Keep this device's order, minus ids others removed, plus ids others added.
    const out = l.filter(id => !(b.has(id) && !rSet.has(id)));
    for (const id of r) if (!b.has(id) && !lSet.has(id)) out.push(id);
    return out;
}

function mergeValue(base, local, remote, path, depth) {
    if (SET_PATHS.has(path)) {
        if (deepEqual(local, base)) return remote;
        if (deepEqual(remote, base)) return local;
        return mergeSet(base, local, remote);
    }
    if (ORDERED_ID_PATHS.has(path)) {
        if (deepEqual(local, base)) return remote;
        if (deepEqual(remote, base)) return local;
        return mergeOrdered(base, local, remote);
    }
    if (deepEqual(local, base)) return remote;   // untouched here: take the latest
    if (deepEqual(remote, base)) return local;   // only changed here
    // Both changed: merge objects key by key, otherwise this (newest) save wins.
    if (depth < MAX_DEPTH && isPlainObject(local) && isPlainObject(remote)) {
        const b = isPlainObject(base) ? base : {};
        const out = {};
        const keys = new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)]);
        for (const key of keys) {
            const v = mergeValue(b[key], local[key], remote[key], path ? `${path}.${key}` : key, depth + 1);
            if (v !== undefined) out[key] = v;
        }
        return out;
    }
    return local;
}

function mergePlanActivity(base, local, remote) {
    const r = isPlainObject(remote) ? remote : {};
    const l = isPlainObject(local) ? local : {};
    const editors = mergeSet(base?.editors, l.editors, r.editors);
    for (const id of asArray(r.editors)) if (!editors.includes(id)) editors.push(id);
    const lt = Date.parse(l.lastEditedAt || '') || 0;
    const rt = Date.parse(r.lastEditedAt || '') || 0;
    const newer = lt >= rt ? l : r;
    return {
        createdBy: r.createdBy || l.createdBy || null,
        editors,
        lastEditedAt: newer.lastEditedAt || null,
        lastEditedBy: newer.lastEditedBy || null
    };
}

/**
 * @returns {{ merged: Object, remoteChanged: boolean, localChanged: boolean }}
 */
export function mergeSessionData(base, local, remote) {
    const b = isPlainObject(base) ? base : {};
    const l = isPlainObject(local) ? local : {};
    const r = isPlainObject(remote) ? remote : {};
    const merged = mergeValue(b, l, r, '', 0) || {};
    merged.planActivity = mergePlanActivity(b.planActivity, l.planActivity, r.planActivity);

    // An item lives in exactly one of Ideas / the plan. If the merge put it in
    // both, keep the side this device chose; otherwise keep the latest side.
    const ideas = isPlainObject(merged.ideasItems) ? merged.ideasItems : {};
    const locked = isPlainObject(merged.lockedInItems) ? merged.lockedInItems : {};
    for (const id of Object.keys(ideas)) {
        if (!(id in locked)) continue;
        const localInIdeas = isPlainObject(l.ideasItems) && id in l.ideasItems;
        const localInLocked = isPlainObject(l.lockedInItems) && id in l.lockedInItems;
        if (localInIdeas && !localInLocked) delete locked[id];
        else if (localInLocked && !localInIdeas) delete ideas[id];
        else if (isPlainObject(r.ideasItems) && id in r.ideasItems) delete locked[id];
        else delete ideas[id];
    }

    return {
        merged,
        remoteChanged: hasMeaningfulDifference(r, b),
        localChanged: hasMeaningfulDifference(l, b)
    };
}

// Bookkeeping that changes on its own (activity stamps, open-count snapshot,
// background thread list, stream metadata) — merged, but never on its own a
// reason to refresh the screen or report a change.
const VOLATILE_KEYS = ['planActivity', 'openConversations', 'background', '_streamMeta'];

export function hasMeaningfulDifference(a, b) {
    const strip = o => {
        const c = { ...(isPlainObject(o) ? o : {}) };
        for (const key of VOLATILE_KEYS) delete c[key];
        return c;
    };
    return !deepEqual(strip(a), strip(b));
}

// ===== Human-readable change list (for Plan History) =====

const DETAIL_LABELS = {
    eventName: null, // handled specially
    date: 'Changed the date',
    dateEnd: 'Changed the end date',
    startTime: 'Changed the start time',
    endTime: 'Changed the end time',
    duration: 'Changed the duration',
    goals: 'Updated the goals',
    guestCount: null, // handled specially
    specialRequests: 'Updated special requests'
};

/**
 * Describe what changed between two versions of a plan's saved data.
 * @param {Object} before
 * @param {Object} after
 * @param {(id: string) => string} nameOf - item id -> display name
 * @returns {Array<{type: string, text: string, itemId?: string}>}
 */
export function describePlanChanges(before, after, nameOf = id => id) {
    const b = isPlainObject(before) ? before : {};
    const a = isPlainObject(after) ? after : {};
    const changes = [];
    const push = (type, text, itemId) => changes.push(itemId ? { type, text, itemId } : { type, text });
    const name = id => `“${nameOf(id) || 'an item'}”`;

    const bIdeas = b.ideasItems || {}, aIdeas = a.ideasItems || {};
    const bLocked = b.lockedInItems || {}, aLocked = a.lockedInItems || {};
    const ids = new Set([...Object.keys(bIdeas), ...Object.keys(aIdeas), ...Object.keys(bLocked), ...Object.keys(aLocked)]);
    for (const id of ids) {
        const wasIdea = id in bIdeas, isIdea = id in aIdeas;
        const wasLocked = id in bLocked, isLocked = id in aLocked;
        if (wasIdea && isLocked && !wasLocked) push('item', `Locked in ${name(id)}`, id);
        else if (wasLocked && isIdea && !wasIdea) push('item', `Moved ${name(id)} to Ideas`, id);
        else if (!wasIdea && !wasLocked && isLocked) push('item', `Added ${name(id)} to the plan`, id);
        else if (!wasIdea && !wasLocked && isIdea) push('item', `Added ${name(id)} as an idea`, id);
        else if ((wasIdea || wasLocked) && !isIdea && !isLocked) push('item', `Removed ${name(id)}`, id);
        else if (isLocked && wasLocked && !deepEqual(bLocked[id], aLocked[id])) push('item', `Updated ${name(id)}`, id);
        else if (isIdea && wasIdea && !deepEqual(bIdeas[id], aIdeas[id])) push('item', `Updated ${name(id)}`, id);
    }

    const setDiff = (key, onAdd, onRemove) => {
        const before = new Set(asArray(b[key])), after = new Set(asArray(a[key]));
        for (const id of after) if (!before.has(id)) push('status', onAdd(name(id)), id);
        for (const id of before) if (!after.has(id)) push('status', onRemove(name(id)), id);
    };
    setDiff('completedItems', n => `Marked ${n} complete`, n => `Reopened ${n}`);
    setDiff('archivedItems', n => `Archived ${n}`, n => `Restored ${n} from the archive`);
    setDiff('goalItems', n => `Marked ${n} as a goal`, n => `Removed ${n} as a goal`);

    const bd = b.eventDetails || {}, ad = a.eventDetails || {};
    for (const key of new Set([...Object.keys(bd), ...Object.keys(ad)])) {
        if (deepEqual(bd[key], ad[key])) continue;
        if (key === '_resolvedChatThreads') {
            const bk = Object.keys(bd[key] || {}), ak = Object.keys(ad[key] || {});
            const resolved = ak.filter(k => !bk.includes(k)).length;
            const reopened = bk.filter(k => !ak.includes(k)).length;
            if (resolved) push('chat', resolved === 1 ? 'Resolved a chat' : `Resolved ${resolved} chats`);
            if (reopened) push('chat', reopened === 1 ? 'Reopened a chat' : `Reopened ${reopened} chats`);
            continue;
        }
        if (key.startsWith('_') || key === 'titleAutoGenerated') continue;
        if (key === 'eventName') {
            push('details', ad[key] ? `Renamed the plan to “${String(ad[key]).slice(0, 80)}”` : 'Cleared the plan name');
        } else if (key === 'guestCount') {
            push('details', ad[key] ? `Set the guest count to ${ad[key]}` : 'Cleared the guest count');
        } else {
            push('details', DETAIL_LABELS[key] || 'Updated the plan details');
        }
    }

    if (!deepEqual(b.planItemOrder || [], a.planItemOrder || [])
        && new Set(asArray(b.planItemOrder)).size === new Set(asArray(a.planItemOrder)).size) {
        push('order', 'Reordered items');
    }
    if (!deepEqual(b.relatedGroups || [], a.relatedGroups || [])) push('group', 'Changed how options are grouped');
    if (!deepEqual(b.combinedItems || {}, a.combinedItems || {})) push('group', 'Merged or separated items');
    const bv = b.activeVariationIndices || {}, av = a.activeVariationIndices || {};
    for (const id of new Set([...Object.keys(bv), ...Object.keys(av)])) {
        if (id in bv && id in av && bv[id] !== av[id]) push('item', `Switched the version of ${name(id)}`, id);
    }

    // Collapse duplicate lines (e.g. several fields of the same detail).
    const seen = new Set();
    return changes.filter(c => (seen.has(c.text) ? false : (seen.add(c.text), true)));
}
