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
const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 350;

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

// ===== The collab menu =====

let openState = null; // { anchor, kind, id, scope, pinned, el }
let openTimer = null;
let closeTimer = null;

function closeMenu() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openState?.el?.remove();
    openState?.anchor?.setAttribute('aria-expanded', 'false');
    openState = null;
}

function position(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function renderMenu() {
    if (!openState) return;
    const { kind, id, anchor } = openState;
    const adapter = adapters.get(kind);
    if (!adapter) return closeMenu();
    const scopes = adapter.scopes(id) || [];
    if (!openState.scope || !scopes.includes(openState.scope)) openState.scope = scopes[0] || null;
    const scope = openState.scope;
    const sources = adapter.sources(id) || [];
    const s = summarizeReactions(mergeReactionMaps(...sources.map(x => x.map)));
    const mine = scope ? (adapter.mine(id, scope) || new Set()) : new Set();
    const comments = adapter.commentCount ? adapter.commentCount(id) : 0;
    const stage = adapter.stage ? adapter.stage(id) : '';
    const openSummary = adapter.openSummary ? adapter.openSummary(id) : '';
    const latest = adapter.latestComments ? adapter.latestComments(id) : [];
    const chatBlock = (openSummary || latest.length) ? `<div class="collab-menu-chats">
            ${openSummary ? `<div class="collab-menu-chats-summary">💬 ${esc(openSummary)}</div>` : ''}
            ${latest.map(c => `<div class="collab-menu-comment"><span class="collab-menu-comment-scope">${c.scope === 'plan' ? '👥' : '🌐'}</span><strong>${esc(c.author)}:</strong> ${esc(String(c.text).slice(0, 90))}${String(c.text).length > 90 ? '…' : ''}</div>`).join('')}
        </div>` : '';
    const breakdown = sources.length > 1
        ? sources.map(x => `${x.icon} ${summarizeReactions(x.map).people} ${esc(x.label)}`).join(' · ')
        : '';

    const el = openState.el || document.createElement('div');
    el.className = 'collab-menu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Collab on ${adapter.title(id)}`);
    el.innerHTML = `
        <div class="collab-menu-head">
            <span class="collab-menu-emoji" aria-hidden="true">${s.has ? esc(s.emoji) : '☺'}</span>
            <div class="collab-menu-summary">
                <div class="collab-menu-title">${esc(adapter.title(id))}${stage ? ` <span class="collab-menu-stage">${esc(stage)}</span>` : ''}</div>
                <div class="collab-menu-meta">${s.has
                    ? `<strong>${esc(s.label)}</strong> (${s.score >= 0 ? '+' : ''}${s.score.toFixed(1)}) · ${s.total} reaction${s.total === 1 ? '' : 's'} from ${s.people} ${s.people === 1 ? 'person' : 'people'}`
                    : 'No reactions yet. Be the first to weigh in.'}${comments ? ` · 💬 ${comments}` : ''}</div>
                ${breakdown ? `<div class="collab-menu-breakdown">${breakdown}</div>` : ''}
            </div>
        </div>
        ${scopes.length > 1 ? `<div class="collab-menu-scope" role="group" aria-label="React for">
            ${scopes.map(sc => {
                const src = sources.find(x => x.scope === sc) || { label: sc, icon: '' };
                return `<button type="button" class="collab-scope-btn${sc === scope ? ' active' : ''}" data-scope="${esc(sc)}" aria-pressed="${sc === scope}">${src.icon} ${esc(src.label)}</button>`;
            }).join('')}</div>` : ''}
        ${scope ? `<div class="collab-menu-reactions" role="group" aria-label="React">
            ${COLLAB_REACTIONS.map(emoji => `<button type="button" class="collab-react-btn${mine.has(emoji) ? ' mine' : ''}" data-emoji="${esc(emoji)}" aria-pressed="${mine.has(emoji)}" title="${esc(emoji)}">${esc(emoji)}${s.counts[emoji] ? `<span class="collab-react-count">${s.counts[emoji]}</span>` : ''}</button>`).join('')}
        </div>` : '<div class="collab-menu-note">Sign in to collab on this.</div>'}
        ${chatBlock}
        <div class="collab-menu-actions"></div>
        <form class="collab-menu-compose" hidden>
            <textarea rows="2" placeholder="Add a comment…" aria-label="Comment"></textarea>
            <button type="submit">Post</button>
        </form>`;

    const actions = el.querySelector('.collab-menu-actions');
    const addAction = (label, run, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `collab-menu-action ${cls}`;
        b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); run(b); });
        actions.appendChild(b);
    };
    if (adapter.comment && scope) {
        addAction('💬 Comment', () => {
            const form = el.querySelector('.collab-menu-compose');
            form.hidden = !form.hidden;
            openState.pinned = true;
            if (!form.hidden) form.querySelector('textarea').focus();
            position(el, anchor);
        });
    }
    if (adapter.openConversation) addAction('See conversation', () => { const sc = scope; closeMenu(); adapter.openConversation(id, sc); });
    if (adapter.moreDetails) addAction('More details →', () => { closeMenu(); adapter.moreDetails(id); }, 'is-more');
    for (const action of (adapter.statusActions ? adapter.statusActions(id) : [])) {
        addAction(action.label, async () => { closeMenu(); await action.run(); refreshCollabSups(kind, id); }, 'is-status');
    }

    el.querySelectorAll('.collab-scope-btn').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        openState.scope = b.dataset.scope;
        openState.pinned = true;
        renderMenu();
    }));
    el.querySelectorAll('.collab-react-btn').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        openState.pinned = true;
        b.disabled = true;
        const result = await adapter.toggle(id, scope, b.dataset.emoji);
        if (result === null) b.disabled = false;
        refreshCollabSups(kind, id);
        window.dispatchEvent(new CustomEvent('collab-updated', { detail: { kind, id } }));
        if (openState && openState.kind === kind && openState.id === id) renderMenu();
    }));
    el.querySelector('.collab-menu-compose')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ta = e.currentTarget.querySelector('textarea');
        const text = ta.value.trim();
        if (!text) return ta.focus();
        const ok = await adapter.comment(id, scope, text);
        if (ok) {
            ta.value = '';
            refreshCollabSups(kind, id);
            renderMenu();
        } else {
            showToast('Could not post that comment.', 3000, 'error');
        }
    });
    el.querySelector('.collab-menu-compose textarea')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); }
    });

    if (!openState.el) {
        openState.el = el;
        el.addEventListener('pointerenter', () => clearTimeout(closeTimer));
        el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !openState?.pinned) scheduleClose(); });
        document.body.appendChild(el);
    }
    position(el, anchor);
}

function openMenu(anchor, pinned) {
    const kind = anchor.dataset.collabKind;
    const id = anchor.dataset.collabId;
    if (!adapters.has(kind)) return;
    if (openState && openState.anchor === anchor) {
        if (pinned) openState.pinned = true;
        return;
    }
    closeMenu();
    openState = { anchor, kind, id, scope: null, pinned, el: null };
    anchor.setAttribute('aria-expanded', 'true');
    renderMenu();
}

/** The status actions a thing offers this person (same list the menu shows). */
export function getCollabStatusActions(kind, id) {
    const adapter = adapters.get(kind);
    return adapter?.statusActions ? adapter.statusActions(id) : [];
}

/** Open the collab menu for the superscript inside (or equal to) `el`. */
export function openCollabMenuFor(el) {
    const sup = el?.classList?.contains('collab-sup') ? el : el?.querySelector?.('.collab-sup');
    if (!sup) return false;
    openMenu(sup, true);
    openState?.el?.querySelector('.collab-react-btn, button')?.focus();
    return true;
}

function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!openState?.pinned) closeMenu(); }, HOVER_CLOSE_MS);
}

let wired = false;
export function initCollabControl() {
    if (wired) return;
    wired = true;
    // Capture phase, so tapping the superscript never also opens/drags the card under it.
    document.addEventListener('click', (e) => {
        const sup = e.target.closest?.('.collab-sup');
        if (sup) {
            e.preventDefault();
            e.stopPropagation();
            if (openState?.anchor === sup && openState.pinned) closeMenu();
            else openMenu(sup, true);
            return;
        }
        if (openState && !e.target.closest?.('.collab-menu')) closeMenu();
    }, true);
    document.addEventListener('pointerdown', (e) => {
        if (e.target.closest?.('.collab-sup')) e.stopPropagation();
    }, true);
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const sup = e.target.closest?.('.collab-sup');
        if (!sup) return;
        clearTimeout(closeTimer);
        if (openState?.anchor === sup) return;
        clearTimeout(openTimer);
        openTimer = setTimeout(() => openMenu(sup, false), HOVER_OPEN_MS);
    });
    document.addEventListener('pointerout', (e) => {
        if (e.pointerType !== 'mouse') return;
        const sup = e.target.closest?.('.collab-sup');
        if (!sup) return;
        clearTimeout(openTimer);
        if (openState?.anchor === sup && !openState.pinned && !e.relatedTarget?.closest?.('.collab-menu')) scheduleClose();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openState) {
            const anchor = openState.anchor;
            closeMenu();
            anchor?.focus?.();
            return;
        }
        const sup = e.target.closest?.('.collab-sup');
        if (sup && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();
            openMenu(sup, true);
            openState?.el?.querySelector('button')?.focus();
        }
    }, true);
    window.addEventListener('scroll', () => { if (openState && !openState.pinned) closeMenu(); else if (openState) position(openState.el, openState.anchor); }, true);
    window.addEventListener('resize', () => openState && position(openState.el, openState.anchor));
    // Reactions arrive from collaborators, saves and the community load: keep sups current.
    document.addEventListener('planStateChanged', () => refreshCollabSups());
    window.addEventListener('open-conversations-updated', () => refreshCollabSups());
    window.addEventListener('collab-updated', (e) => {
        if (e.detail?.kind) refreshCollabSups(e.detail.kind, e.detail.id);
        if (openState && openState.kind === e.detail?.kind && openState.id === e.detail?.id) renderMenu();
    });
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
    moreDetails: async (id) => {
        const record = getRecordById(id);
        if (!record) return;
        const { showDetailModal } = await import('../modal.js');
        await showDetailModal(record);
        setTimeout(() => document.getElementById('modal-collab-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
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
