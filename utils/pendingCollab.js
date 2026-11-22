// Collab attempted while signed out (reactions and comments on community items).
//
// Reactions are open to everyone: a signed-out reaction is shown right away and
// held on this device. Comments need an account: the text is held while the visitor
// signs in. Either way, the held collab is sent as soon as they sign in — whether
// that's a brand-new account or an existing one on a new device — and then cleared.
import * as api from '../api.js';

const KEY = 'wtf.pendingCollab';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

function read() {
    try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list.filter(e => e && Date.now() - (e.at || 0) < MAX_AGE_MS) : [];
    } catch {
        return [];
    }
}

function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* storage blocked */ }
}

const reactionKey = e => JSON.stringify([e.publicItemId ?? null, e.opts?.catalogItemId ?? null, e.variationId ?? null, e.opts?.commentId ?? null, e.emoji]);

/**
 * Toggle a held reaction (tapping the same emoji again removes it).
 * @returns {boolean} whether the reaction is now held
 */
export function togglePendingReaction(publicItemId, emoji, variationId = null, opts = {}) {
    const entry = { kind: 'reaction', publicItemId, emoji, variationId, opts, at: Date.now() };
    const list = read();
    const key = reactionKey(entry);
    const index = list.findIndex(e => e.kind === 'reaction' && reactionKey(e) === key);
    if (index >= 0) {
        list.splice(index, 1);
        write(list);
        return false;
    }
    list.push(entry);
    write(list);
    return true;
}

export function isReactionPending(publicItemId, emoji, variationId = null, opts = {}) {
    const key = reactionKey({ publicItemId, emoji, variationId, opts });
    return read().some(e => e.kind === 'reaction' && reactionKey(e) === key);
}

export function queuePendingComment(publicItemId, body, variationId = null, opts = {}) {
    const list = read();
    list.push({ kind: 'comment', publicItemId, body, variationId, opts, at: Date.now() });
    write(list);
}

export function pendingCollabCount() {
    return read().length;
}

let flushing = null;

/** Send everything held on this device under the signed-in account. */
export function flushPendingCollab(authorName = null) {
    if (flushing) return flushing;
    const list = read();
    if (list.length === 0) return Promise.resolve({ sent: 0, failed: 0 });
    flushing = (async () => {
        const failed = [];
        let sent = 0;
        for (const entry of list) {
            try {
                const ok = entry.kind === 'reaction'
                    ? await api.togglePublicReaction(entry.publicItemId, entry.emoji, entry.variationId, { ...entry.opts, ensure: true })
                    : await api.addPublicComment(entry.publicItemId, entry.body, authorName, entry.variationId, entry.opts || {});
                if (ok) sent++;
                else failed.push(entry);
            } catch {
                failed.push(entry);
            }
        }
        write(failed);
        if (sent > 0) {
            try { window.dispatchEvent(new CustomEvent('pending-collab-sent', { detail: { sent } })); } catch { /* non-browser */ }
        }
        return { sent, failed: failed.length };
    })().finally(() => { flushing = null; });
    return flushing;
}
