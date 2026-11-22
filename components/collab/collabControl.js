// FILE: components/collab/collabControl.js
//
// One collab interface for everything collab-able: items, variants, chat messages
// and comments (options and portions of text/images later).
//
//   • A superscript sentiment emoji right after the thing's title — the summary of
//     everyone's reactions — so people see the response at a glance.
//   • Hover (mouse) or tap/Enter opens the collab menu: the details behind the
//     summary, the 8 scored reactions (one click to weigh in), Comment, and status
//     actions where the viewer can change status.
//
// Each kind of thing registers an adapter; the UI is the same for all of them.
// Storage stays where it is today (plan data, chat messages, community database).
import { state, getRecordById, getAggregateReactions } from '../../state.js';
import * as api from '../../api.js';
import { showToast } from '../../ui.js';
import { isPlanReadOnly } from '../../utils/planAccess.js';
import { COLLAB_REACTIONS, mergeReactionMaps, summarizeReactions } from '../../utils/collabSummary.js';
import {
    toggleCommunityReactionForRecord, addCommunityCommentForRecord, communityUserMapForRecord,
    communityCommentCountForRecord, COLLAB_GUEST_ID, isPublicIdeaRecord, collabStageOf, COLLAB_STAGE_LABELS,
    latestCommunityComments, collabIdeaStageActions
} from '../publicCatalog.js';
import { getOpenConversationCounts, planMessagesForItem } from '../../utils/openConversations.js';
import { taskMessageText } from '../../utils/taskDiscussion.js';

const adapters = new Map();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Adapter shape (all functions receive the thing's id):
 *   title(id)                      -> string
 *   sources(id)                    -> [{ scope, label, icon, map: Map<user, Set<emoji>> }]
 *   scopes(id)                     -> scopes the viewer can react in, preferred first
 *   mine(id, scope)                -> Set<emoji> the viewer reacted in that scope
 *   toggle(id, scope, emoji)       -> Promise<boolean|null>
 *   commentCount?(id)              -> number
 *   openCount?(id)                 -> open comment count shown in the superscript
 *   latestComments?(id)            -> [{ author, text, scope }] newest first (menu preview)
 *   moreDetails?(id)               -> open the full detail view
 *   comment?(id, scope, text)      -> Promise<boolean>
 *   openConversation?(id, scope)   -> void
 *   statusActions?(id)             -> [{ label, run }]
 *   stage?(id)                     -> short status label shown in the menu
 */
export function registerCollabKind(kind, adapter) {
    adapters.set(kind, adapter);
}

function summaryFor(kind, id) {
    const adapter = adapters.get(kind);
    if (!adapter) return summarizeReactions(new Map());
    const sources = adapter.sources(id) || [];
    return summarizeReactions(mergeReactionMaps(...sources.map(s => s.map)));
}

function supParts(kind, id) {
    const s = summaryFor(kind, id);
    const adapter = adapters.get(kind);
    const open = adapter?.openCount ? Number(adapter.openCount(id)) || 0 : 0;
    return { s, open };
}

function supInner({ s, open }) {
    return `<span class="collab-sup-emoji">${s.has ? esc(s.emoji) : '☺'}</span>${open > 0 ? `<span class="collab-sup-count">${open}</span>` : ''}`;
}

function supLabel({ s, open }, title) {
    const parts = [s.has ? `${s.label}, ${s.total} reaction${s.total === 1 ? '' : 's'}` : 'No reactions yet'];
    if (open > 0) parts.push(`${open} open comment${open === 1 ? '' : 's'}`);
    return `${parts.join(' · ')}. Collab on ${title || 'this'}`;
}

/** The superscript markup to place right after a title: sentiment emoji + open comment count. */
export function collabSupHTML(kind, id, title = '') {
    if (!kind || id == null) return '';
    const parts = supParts(kind, id);
    const label = supLabel(parts, title);
    return `<sup class="collab-sup${parts.s.has ? ' has-reactions' : ''}${parts.open ? ' has-open' : ''}" data-collab-kind="${esc(kind)}" data-collab-id="${esc(id)}" data-collab-title="${esc(title)}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${esc(label)}" title="${esc(label)}">${supInner(parts)}</sup>`;
}

/** Re-draw every superscript for one thing (or all of them). */
export function refreshCollabSups(kind = null, id = null) {
    const selector = kind
        ? `.collab-sup[data-collab-kind="${CSS.escape(kind)}"]${id != null ? `[data-collab-id="${CSS.escape(String(id))}"]` : ''}`
        : '.collab-sup';
    document.querySelectorAll(selector).forEach(el => {
        const parts = supParts(el.dataset.collabKind, el.dataset.collabId);
        el.innerHTML = supInner(parts);
        el.classList.toggle('has-reactions', parts.s.has);
        el.classList.toggle('has-open', parts.open > 0);
        const label = supLabel(parts, el.dataset.collabTitle || '');
        el.setAttribute('aria-label', label);
        el.title = label;
    });
}

// ===== Selecting a superscript =====
//
// Everything collab happens in the conversations panel:
//   • an item's (or version's) superscript opens the panel scoped to that item —
//     its reactions, status and combined conversation;
//   • a message or comment superscript inside the panel opens a one-click reaction
//     row right under that message.

const ITEM_KINDS = new Set(['item', 'variant']);

function recordIdFor(kind, id) {
    if (kind === 'variant') return String(id).slice(0, String(id).lastIndexOf('::'));
    return id;
}

async function openPanelForItem(recordId) {
    const { openUCPConversations } = await import('../unifiedChatPanel.js');
    openUCPConversations(recordId);
}

function closeInlineRows(except = null) {
    document.querySelectorAll('.collab-inline-react').forEach(row => {
        if (row === except) return;
        row.previousSupEl?.setAttribute?.('aria-expanded', 'false');
        row.remove();
    });
}

function renderInlineRow(sup) {
    const kind = sup.dataset.collabKind;
    const id = sup.dataset.collabId;
    const adapter = adapters.get(kind);
    if (!adapter) return;
    const host = sup.closest('[data-collab-inline-host]') || sup.parentElement;
    const existing = host.querySelector(':scope > .collab-inline-react');
    const scope = (adapter.scopes(id) || [])[0] || null;
    const s = summaryFor(kind, id);
    const mine = scope ? (adapter.mine(id, scope) || new Set()) : new Set();
    const row = existing || document.createElement('div');
    row.className = 'collab-inline-react';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `React to ${adapter.title(id)}`);
    row.innerHTML = scope
        ? COLLAB_REACTIONS.map(emoji => `<button type="button" class="collab-react-btn${mine.has(emoji) ? ' mine' : ''}" data-emoji="${esc(emoji)}" aria-pressed="${mine.has(emoji)}">${esc(emoji)}${s.counts[emoji] ? `<span class="collab-react-count">${s.counts[emoji]}</span>` : ''}</button>`).join('')
        : '<span class="collab-menu-note">Sign in to react.</span>';
    row.querySelectorAll('.collab-react-btn').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        b.disabled = true;
        await adapter.toggle(id, scope, b.dataset.emoji);
        refreshCollabSups(kind, id);
        const freshSup = document.querySelector(`.collab-sup[data-collab-kind="${CSS.escape(kind)}"][data-collab-id="${CSS.escape(String(id))}"]`);
        if (freshSup) renderInlineRow(freshSup); else row.remove();
    }));
    row.previousSupEl = sup;
    if (!existing) host.appendChild(row);
    sup.setAttribute('aria-expanded', 'true');
    closeInlineRows(row);
}

function activateSup(sup) {
    const kind = sup.dataset.collabKind;
    if (ITEM_KINDS.has(kind)) {
        closeInlineRows();
        openPanelForItem(recordIdFor(kind, sup.dataset.collabId));
        return;
    }
    const host = sup.closest('[data-collab-inline-host]') || sup.parentElement;
    const open = host?.querySelector(':scope > .collab-inline-react');
    if (open) { open.remove(); sup.setAttribute('aria-expanded', 'false'); }
    else renderInlineRow(sup);
}

/** Where an item's reactions and comments go right now ('plan' | 'community' | null). */
export function resolveItemScope(recordId, preferred = null) {
    const scopes = adapters.get('item')?.scopes(recordId) || [];
    return scopes.includes(preferred) ? preferred : (scopes[0] || null);
}

/** The status actions a thing offers this person. */
export function getCollabStatusActions(kind, id) {
    const adapter = adapters.get(kind);
    return adapter?.statusActions ? adapter.statusActions(id) : [];
}

/** Act as if the superscript inside (or equal to) `el` was selected. */
export function openCollabMenuFor(el) {
    const sup = el?.classList?.contains('collab-sup') ? el : el?.querySelector?.('.collab-sup');
    if (!sup) return false;
    activateSup(sup);
    return true;
}

/**
 * The item header shown at the top of the conversations panel when it is scoped
 * to one item: combined summary, 👥/🌐 breakdown, one-click reactions with the
 * This plan / Community choice (which also decides where comments go), and the
 * status actions this person may take.
 * @param {string} recordId
 * @param {{ scope: string|null, onScopeChange: Function, onChange: Function }} opts
 */
export function buildItemCollabHeader(recordId, { scope = null, onScopeChange = () => {}, onChange = () => {} } = {}) {
    const adapter = adapters.get('item');
    const el = document.createElement('div');
    el.className = 'ucp-item-collab';
    if (!adapter || !getRecordById(recordId)) return el;
    const scopes = adapter.scopes(recordId) || [];
    const active = scopes.includes(scope) ? scope : scopes[0] || null;
    const sources = adapter.sources(recordId) || [];
    const s = summarizeReactions(mergeReactionMaps(...sources.map(x => x.map)));
    const mine = active ? (adapter.mine(recordId, active) || new Set()) : new Set();
    const stage = adapter.stage ? adapter.stage(recordId) : '';
    const open = adapter.openSummary ? adapter.openSummary(recordId) : '';
    el.innerHTML = `
        <div class="collab-menu-head">
            <span class="collab-menu-emoji" aria-hidden="true">${s.has ? esc(s.emoji) : '☺'}</span>
            <div class="collab-menu-summary">
                <div class="collab-menu-title">${esc(adapter.title(recordId))}${stage ? ` <span class="collab-menu-stage">${esc(stage)}</span>` : ''}</div>
                <div class="collab-menu-meta">${s.has
                    ? `<strong>${esc(s.label)}</strong> (${s.score >= 0 ? '+' : ''}${s.score.toFixed(1)}) · ${s.total} reaction${s.total === 1 ? '' : 's'} from ${s.people} ${s.people === 1 ? 'person' : 'people'}`
                    : 'No reactions yet. Be the first to weigh in.'}</div>
                <div class="collab-menu-breakdown">${sources.map(x => `${x.icon} ${summarizeReactions(x.map).people} ${esc(x.label)}`).join(' · ')}${open ? ` · 💬 ${esc(open)}` : ''}</div>
            </div>
        </div>
        ${scopes.length > 1 ? `<div class="collab-menu-scope" role="radiogroup" aria-label="React and comment for">
            ${scopes.map(sc => `<button type="button" role="radio" class="collab-scope-btn${sc === active ? ' active' : ''}" data-scope="${esc(sc)}" aria-checked="${sc === active}">${sc === 'plan' ? '👥 This plan' : '🌐 Community'}</button>`).join('')}
        </div>` : ''}
        ${active ? `<div class="collab-menu-reactions" role="group" aria-label="React">
            ${COLLAB_REACTIONS.map(emoji => `<button type="button" class="collab-react-btn${mine.has(emoji) ? ' mine' : ''}" data-emoji="${esc(emoji)}" aria-pressed="${mine.has(emoji)}" title="${esc(emoji)}">${esc(emoji)}${s.counts[emoji] ? `<span class="collab-react-count">${s.counts[emoji]}</span>` : ''}</button>`).join('')}
        </div>` : '<div class="collab-menu-note">Sign in to collab on this.</div>'}
        <div class="collab-menu-actions"></div>`;
    el.querySelectorAll('.collab-scope-btn').forEach(b => b.addEventListener('click', () => onScopeChange(b.dataset.scope)));
    el.querySelectorAll('.collab-react-btn').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        await adapter.toggle(recordId, active, b.dataset.emoji);
        refreshCollabSups('item', recordId);
        window.dispatchEvent(new CustomEvent('collab-updated', { detail: { kind: 'item', id: recordId } }));
        onChange();
    }));
    const actions = el.querySelector('.collab-menu-actions');
    for (const action of getCollabStatusActions('item', recordId)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'collab-menu-action is-status';
        b.textContent = action.label;
        b.addEventListener('click', async () => { await action.run(); refreshCollabSups('item', recordId); onChange(); });
        actions.appendChild(b);
    }
    return el;
}

let wired = false;
export function initCollabControl() {
    if (wired) return;
    wired = true;
    // Capture phase, so selecting a superscript never also opens/drags the card under it.
    document.addEventListener('click', (e) => {
        const sup = e.target.closest?.('.collab-sup');
        if (sup) {
            e.preventDefault();
            e.stopPropagation();
            activateSup(sup);
            return;
        }
        if (!e.target.closest?.('.collab-inline-react')) closeInlineRows();
    }, true);
    document.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('.collab-sup')) e.stopPropagation();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeInlineRows(); return; }
        const sup = e.target.closest?.('.collab-sup');
        if (sup && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();
            activateSup(sup);
        }
    }, true);
    // Reactions arrive from collaborators, saves and the community load: keep sups current.
    document.addEventListener('planStateChanged', () => refreshCollabSups());
    window.addEventListener('open-conversations-updated', () => refreshCollabSups());
    window.addEventListener('collab-updated', (e) => refreshCollabSups(e.detail?.kind || null, e.detail?.id ?? null));
}

// ===== Adapters: items and their variants =====

function me() {
    const u = state.session?.user || {};
    return { id: u.id || null, name: u.name || 'You', signedIn: !!u.isAuthenticated };
}

function inPlan(id) {
    return !!(state.cart?.lockedItems?.has(id) || state.cart?.items?.has(id));
}

function planWritable(id) {
    return inPlan(id) && !!state.session?.id && !isPlanReadOnly() && !!me().id;
}

registerCollabKind('item', {
    title: (id) => getRecordById(id)?.fields?.Name || 'this item',
    stage: (id) => {
        const record = getRecordById(id);
        if (!record || !isPublicIdeaRecord(record)) return '';
        return COLLAB_STAGE_LABELS[collabStageOf(record)] || '';
    },
    // Always combined: this plan's collaborators plus the whole community.
    sources: (id) => {
        const record = getRecordById(id);
        const out = [];
        const planMap = getAggregateReactions(id);
        if (inPlan(id) || planMap.size > 0) out.push({ scope: 'plan', label: 'in this plan', icon: '👥', map: planMap });
        if (record) out.push({ scope: 'community', label: 'community', icon: '🌐', map: communityUserMapForRecord(record) });
        return out;
    },
    // In the plan view, a plan item's reactions default to the plan.
    scopes: (id) => {
        const list = [];
        const preferPlan = document.body.classList.contains('presentation-active');
        if (planWritable(id)) list.push('plan');
        if (getRecordById(id)) list.push('community');
        return preferPlan ? list : list.reverse();
    },
    mine: (id, scope) => {
        const user = me();
        if (scope === 'plan') {
            const data = state.session?.reactions?.get(id)?.get(user.id);
            return data instanceof Set ? data : new Set(data ? [data] : []);
        }
        return communityUserMapForRecord(getRecordById(id)).get(user.id || COLLAB_GUEST_ID) || new Set();
    },
    toggle: async (id, scope, emoji) => {
        if (scope === 'plan') {
            const { togglePlanReaction } = await import('../presentation/reactions.js');
            return togglePlanReaction(id, emoji);
        }
        const record = getRecordById(id);
        return record ? toggleCommunityReactionForRecord(record, emoji) : null;
    },
    commentCount: (id) => communityCommentCountForRecord(getRecordById(id)) + planMessagesForItem(id).length,
    // Open comments: this plan's open chats/tasks on the item, plus community comments.
    openCount: (id) => {
        const plan = inPlan(id) ? (getOpenConversationCounts().byItem.get(id)?.total || 0) : 0;
        return plan + communityCommentCountForRecord(getRecordById(id));
    },
    openSummary: (id) => {
        const c = inPlan(id) ? getOpenConversationCounts().byItem.get(id) : null;
        const parts = [];
        if (c?.chats) parts.push(`${c.chats} open chat${c.chats === 1 ? '' : 's'}`);
        if (c?.tasks) parts.push(`${c.tasks} open task${c.tasks === 1 ? '' : 's'}`);
        const community = communityCommentCountForRecord(getRecordById(id));
        if (community) parts.push(`${community} community comment${community === 1 ? '' : 's'}`);
        return parts.join(' · ');
    },
    latestComments: (id) => {
        const plan = planMessagesForItem(id).slice(0, 2).map(r => ({
            author: r.fields.SenderName || 'Someone', text: taskMessageText(r.fields.Content || '').replace(/^\[IDEA\]\s*/, ''),
            at: r.fields.Timestamp || r.createdTime, scope: 'plan'
        }));
        return [...plan, ...latestCommunityComments(getRecordById(id), 2)]
            .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
            .slice(0, 2);
    },
    comment: async (id, scope, text) => {
        if (scope === 'plan') {
            const user = me();
            const result = await api.postChatMessage(state.session.id, user.id, user.name, text, id);
            if (result) window.dispatchEvent(new CustomEvent('plan-chat-activity'));
            return !!result;
        }
        const created = await addCommunityCommentForRecord(getRecordById(id), text);
        return !!created;
    },
    // The one full view for every access point: the item detail, opened at its Collab section.
    // "Suggest a version" opens the item detail at its Versions list.
    moreDetails: async (id) => {
        const record = getRecordById(id);
        if (!record) return;
        const { showDetailModal } = await import('../modal.js');
        await showDetailModal(record);
        setTimeout(() => document.getElementById('modal-item-variations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    },
    statusActions: (id) => {
        const record = getRecordById(id);
        const list = [];
        // Plan status, for plan collaborators (in the plan view).
        if (document.body.classList.contains('presentation-active') && planWritable(id)) {
            const locked = state.cart.lockedItems.has(id);
            const completed = state.session.completedItems?.has?.(id);
            const run = (fn) => async () => { const m = await import('../presentation/itemActions.js'); await m[fn](id); };
            if (!locked) list.push({ label: '🔒 Lock in', run: run('lockItem') });
            if (locked) list.push({ label: '💡 Move to Ideas', run: run('moveToIdeas') });
            if (!completed) list.push({ label: '✓ Mark complete', run: run('completeItem') });
            list.push({ label: '📦 Archive', run: run('archiveItem') });
            list.push({ label: '✕ Remove from plan', run: run('deleteItem') }); // asks to confirm
        }
        // Collab stage, for store admins.
        if (record && isPublicIdeaRecord(record)) list.push(...collabIdeaStageActions(record));
        // Anyone signed in can suggest a version.
        if (record && me().signedIn) list.push({ label: '✏️ Suggest a version', run: () => adapters.get('item').moreDetails(id) });
        return list;
    }
});

// Variants: community reactions and comments on one version of an item.
// id = "<recordId>::<variationId>"
const splitVariant = (id) => {
    const at = String(id).lastIndexOf('::');
    return { recordId: String(id).slice(0, at), variationId: Number(String(id).slice(at + 2)) };
};

registerCollabKind('variant', {
    title: (id) => {
        const { recordId } = splitVariant(id);
        return `a version of ${getRecordById(recordId)?.fields?.Name || 'this item'}`;
    },
    sources: (id) => {
        const { recordId, variationId } = splitVariant(id);
        const record = getRecordById(recordId);
        return record ? [{ scope: 'community', label: 'community', icon: '🌐', map: communityUserMapForRecord(record, variationId) }] : [];
    },
    scopes: (id) => (getRecordById(splitVariant(id).recordId) ? ['community'] : []),
    mine: (id) => {
        const { recordId, variationId } = splitVariant(id);
        return communityUserMapForRecord(getRecordById(recordId), variationId).get(me().id || COLLAB_GUEST_ID) || new Set();
    },
    toggle: (id, scope, emoji) => {
        const { recordId, variationId } = splitVariant(id);
        const record = getRecordById(recordId);
        return record ? toggleCommunityReactionForRecord(record, emoji, variationId) : null;
    },
    commentCount: (id) => {
        const { recordId, variationId } = splitVariant(id);
        return communityCommentCountForRecord(getRecordById(recordId), variationId);
    },
    comment: async (id, scope, text) => {
        const { recordId, variationId } = splitVariant(id);
        return !!(await addCommunityCommentForRecord(getRecordById(recordId), text, variationId));
    },
    openCount: (id) => {
        const { recordId, variationId } = splitVariant(id);
        return communityCommentCountForRecord(getRecordById(recordId), variationId);
    },
    moreDetails: (id) => adapters.get('item').moreDetails(splitVariant(id).recordId)
});
