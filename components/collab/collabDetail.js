// FILE: components/collab/collabDetail.js
//
// The full collab view for an item: the Collab section of the item detail. Every
// "More details / See conversation" from the collab menu lands here, from any view.
//
//   • Reactions: the combined summary with its plan / community breakdown, and the
//     8 one-click reactions with the same "This plan / Community" choice as the menu.
//   • Status: the item's plan status and collab stage, with the status actions this
//     person may take.
//   • Conversation: one combined timeline of this plan's chat about the item and the
//     community thread, each comment marked 👥 or 🌐, with a filter to narrow it.
//     Every comment carries its own superscript (comments are collab-able too).
//   • A quick comment box, posting to this plan or the community.
import { state, getRecordById } from '../../state.js';
import * as api from '../../api.js';
import { showToast } from '../../ui.js';
import { isPlanReadOnly } from '../../utils/planAccess.js';
import { COLLAB_REACTIONS, mergeReactionMaps, summarizeReactions, emojiUsersToMap } from '../../utils/collabSummary.js';
import { messageReactions, taskMessageText } from '../../utils/taskDiscussion.js';
import { togglePendingReaction } from '../../utils/pendingCollab.js';
import {
    initOpenConversations, planMessagesForItem, planMessagesLoaded, getPlanMessage
} from '../../utils/openConversations.js';
import {
    getCommunityRowForRecord, communityCommentsForRecord, collabUserName, isPublicIdeaRecord,
    collabStatusOf, collabTimeOf, COLLAB_STAGE_LABELS, COLLAB_GUEST_ID
} from '../publicCatalog.js';
import { registerCollabKind, collabSupHTML, refreshCollabSups } from './collabControl.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const view = { recordId: null, filter: 'all', scope: null, loadingFor: null, triedFor: null };

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

function when(at) {
    if (!at) return '';
    const d = new Date(at);
    if (isNaN(d)) return '';
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ===== Comments are collab targets too =====

// Plan chat messages (id = message record id).
registerCollabKind('planmsg', {
    title: (id) => `${getPlanMessage(id)?.fields?.SenderName || 'Someone'}'s comment`,
    sources: (id) => [{ scope: 'plan', label: 'in this plan', icon: '👥', map: emojiUsersToMap(messageReactions(getPlanMessage(id)?.fields?.Reactions)) }],
    scopes: (id) => (getPlanMessage(id) && me().id && !isPlanReadOnly() ? ['plan'] : []),
    mine: (id) => emojiUsersToMap(messageReactions(getPlanMessage(id)?.fields?.Reactions)).get(me().id) || new Set(),
    toggle: async (id, scope, emoji) => {
        const record = getPlanMessage(id);
        if (!record || !me().id) return null;
        const current = messageReactions(record.fields.Reactions);
        const add = !(current[emoji] || []).includes(me().id);
        const result = await api.toggleMessageReaction(id, me().id, emoji, add);
        if (result == null) return null;
        record.fields.Reactions = JSON.stringify(result);
        return add;
    },
    openCount: (id) => planComments(getPlanMessage(id)?.fields?.['Item Link']?.[0] || view.recordId).filter(c => c.parentId === id).length
});

// Community comments (id = "<recordId>::<commentId>").
const splitComment = (id) => {
    const at = String(id).lastIndexOf('::');
    return { recordId: String(id).slice(0, at), commentId: Number(String(id).slice(at + 2)) };
};
const findCommunityComment = (id) => {
    const { recordId, commentId } = splitComment(id);
    const row = getCommunityRowForRecord(getRecordById(recordId));
    return { row, comment: (row?.comments || []).find(c => c.id === commentId) || null };
};
const communityCommentMap = (comment) => {
    const map = new Map();
    for (const [emoji, data] of Object.entries(comment?.reactions || {})) {
        for (const userId of data?.users || []) {
            if (!map.has(userId)) map.set(userId, new Set());
            map.get(userId).add(emoji);
        }
    }
    return map;
};

registerCollabKind('ccomment', {
    title: (id) => `${findCommunityComment(id).comment?.authorName || 'Someone'}'s comment`,
    sources: (id) => [{ scope: 'community', label: 'community', icon: '🌐', map: communityCommentMap(findCommunityComment(id).comment) }],
    scopes: (id) => (findCommunityComment(id).comment ? ['community'] : []),
    mine: (id) => communityCommentMap(findCommunityComment(id).comment).get(me().id || COLLAB_GUEST_ID) || new Set(),
    toggle: async (id, scope, emoji) => {
        const { row, comment } = findCommunityComment(id);
        if (!row || !comment) return null;
        const result = me().signedIn
            ? await api.togglePublicReaction(row.id, emoji, null, { commentId: comment.id })
            : { reacted: togglePendingReaction(row.id, emoji, null, { commentId: comment.id }) };
        if (!result) return null;
        const who = me().id || COLLAB_GUEST_ID;
        comment.reactions = comment.reactions || {};
        const entry = comment.reactions[emoji] || { count: 0, users: [] };
        if (result.reacted && !entry.users.includes(who)) { entry.users.push(who); entry.count++; }
        if (!result.reacted) { entry.users = entry.users.filter(u => u !== who); entry.count = Math.max(0, entry.count - 1); }
        if (entry.count > 0) comment.reactions[emoji] = entry; else delete comment.reactions[emoji];
        return !!result.reacted;
    },
    openCount: (id) => {
        const { row, comment } = findCommunityComment(id);
        return (row?.comments || []).filter(c => comment && c.parentCommentId === comment.id).length;
    }
});

// ===== Timeline =====

function planComments(recordId) {
    return planMessagesForItem(recordId)
        .slice()
        .reverse()
        .map(r => ({
            id: r.id, kind: 'planmsg', scope: 'plan', author: r.fields.SenderName || 'Someone',
            text: taskMessageText(r.fields.Content || '').replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '').replace(/^\[IDEA\]\s*/, ''),
            at: r.fields.Timestamp || r.createdTime, parentId: r.fields.ParentMessageID || null
        }));
}

function timeline(record) {
    const plan = view.filter === 'community' ? [] : planComments(record.id);
    const community = view.filter === 'plan' ? [] : communityCommentsForRecord(record).map(c => ({
        ...c, kind: 'ccomment', supId: `${record.id}::${c.id}`
    }));
    return [...plan, ...community].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function ensurePlanMessages(record) {
    const sessionId = state.session?.id;
    // One read per plan (a failed read is not retried in a loop).
    if (!sessionId || planMessagesLoaded() || view.loadingFor === sessionId || view.triedFor === sessionId) return;
    view.loadingFor = sessionId;
    view.triedFor = sessionId;
    initOpenConversations({ fetchChatMessages: api.fetchChatMessages });
    Promise.resolve(api.fetchChatMessages(sessionId)).finally(() => {
        view.loadingFor = null;
        if (view.recordId === record.id) renderCollabDetail(document.getElementById('modal-collab-section'), record);
    });
}

// ===== Render =====

export function renderCollabDetail(section, record) {
    if (!section) return;
    if (!record) { section.style.display = 'none'; return; }
    if (view.recordId !== record.id) { view.recordId = record.id; view.filter = 'all'; view.scope = null; }
    ensurePlanMessages(record);

    const id = record.id;
    const planMap = (() => {
        const map = new Map();
        for (const [key, users] of state.session?.reactions || []) {
            if (key !== id && !String(key).startsWith(`${id}::`)) continue;
            for (const [userId, set] of users) map.set(userId, set instanceof Set ? set : new Set([set]));
        }
        return map;
    })();
    const row = getCommunityRowForRecord(record);
    const communityMap = new Map();
    for (const [emoji, data] of Object.entries(row?.reactions || {})) {
        for (const userId of data?.users || []) {
            if (!communityMap.has(userId)) communityMap.set(userId, new Set());
            communityMap.get(userId).add(emoji);
        }
    }
    const s = summarizeReactions(mergeReactionMaps(planMap, communityMap));
    const planS = summarizeReactions(planMap);
    const commS = summarizeReactions(communityMap);

    const scopes = [];
    if (planWritable(id)) scopes.push('plan');
    scopes.push('community');
    if (!view.scope || !scopes.includes(view.scope)) {
        view.scope = document.body.classList.contains('presentation-active') && scopes.includes('plan') ? 'plan' : scopes[0];
    }
    const mineMap = view.scope === 'plan' ? planMap : communityMap;
    const mine = mineMap.get(view.scope === 'plan' ? me().id : (me().id || COLLAB_GUEST_ID)) || new Set();

    // Status line: plan status + collab stage (time shown alongside).
    const statusBits = [];
    if (inPlan(id)) {
        const st = state.session.completedItems?.has?.(id) ? 'Complete'
            : state.session.archivedItems?.has?.(id) ? 'Archived'
            : state.cart.lockedItems.has(id) ? 'Locked in' : 'Idea';
        statusBits.push(`📋 In your plan · ${st}`);
    }
    if (row && isPublicIdeaRecord(record)) {
        let stage = COLLAB_STAGE_LABELS[collabStatusOf(row)] || '';
        const time = collabTimeOf(row);
        if (time === 'scheduled') stage += ` · 📅 ${new Date(row.scheduledFor).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        if (time === 'delivered') stage += ' · 🎉 Delivered';
        if (stage) statusBits.push(`💡 ${stage}`);
    }

    const items = timeline(record);
    const byId = new Map(items.map(c => [String(c.id), c]));
    const canComment = view.scope === 'community' || planWritable(id);

    section.style.display = 'block';
    section.className = 'modal-collab-section';
    section.innerHTML = `
        <div class="collab-detail-head">
            <span class="collab-detail-emoji" aria-hidden="true">${s.has ? esc(s.emoji) : '☺'}</span>
            <div>
                <h3 class="collab-detail-title">Collab</h3>
                <div class="collab-detail-meta">${s.has
                    ? `<strong>${esc(s.label)}</strong> (${s.score >= 0 ? '+' : ''}${s.score.toFixed(1)}) · ${s.total} reaction${s.total === 1 ? '' : 's'} from ${s.people} ${s.people === 1 ? 'person' : 'people'}`
                    : 'No reactions yet. Be the first to weigh in.'}</div>
                <div class="collab-detail-breakdown">👥 ${planS.people} in this plan${planS.has ? ` ${esc(planS.emoji)}` : ''} · 🌐 ${commS.people} community${commS.has ? ` ${esc(commS.emoji)}` : ''}</div>
                ${statusBits.length ? `<div class="collab-detail-status">${statusBits.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : ''}
            </div>
        </div>
        ${scopes.length > 1 ? `<div class="collab-menu-scope" role="radiogroup" aria-label="React and comment for">
            ${scopes.map(sc => `<button type="button" role="radio" class="collab-scope-btn${sc === view.scope ? ' active' : ''}" data-scope="${sc}" aria-checked="${sc === view.scope}">${sc === 'plan' ? '👥 This plan' : '🌐 Community'}</button>`).join('')}
        </div>` : ''}
        <div class="collab-menu-reactions collab-detail-reactions" role="group" aria-label="React">
            ${COLLAB_REACTIONS.map(emoji => `<button type="button" class="collab-react-btn${mine.has(emoji) ? ' mine' : ''}" data-emoji="${esc(emoji)}" aria-pressed="${mine.has(emoji)}" title="${esc(emoji)} · 👥 ${planS.counts[emoji] || 0} · 🌐 ${commS.counts[emoji] || 0}">${esc(emoji)}${s.counts[emoji] ? `<span class="collab-react-count">${s.counts[emoji]}</span>` : ''}</button>`).join('')}
        </div>
        <div class="collab-detail-status-actions collab-menu-actions"></div>
        <div class="collab-detail-convo">
            <div class="collab-detail-convo-head">
                <h4>Conversation <span class="collab-detail-count">${items.length}</span></h4>
                <div class="collab-detail-filter" role="radiogroup" aria-label="Show comments from">
                    ${[['all', 'All'], ['plan', '👥 This plan'], ['community', '🌐 Community']].map(([v, l]) =>
                        `<label><input type="radio" name="collab-detail-filter" value="${v}"${view.filter === v ? ' checked' : ''}> ${l}</label>`).join('')}
                </div>
            </div>
            <div class="collab-detail-timeline">
                ${items.length ? items.map(c => {
                    const parent = c.parentId != null ? byId.get(String(c.parentId)) : null;
                    return `<div class="collab-detail-comment${c.parentId != null ? ' is-reply' : ''}">
                        <div class="collab-detail-comment-head">
                            <span class="collab-detail-comment-scope" title="${c.scope === 'plan' ? 'This plan' : 'Community'}">${c.scope === 'plan' ? '👥' : '🌐'}</span>
                            <strong>${esc(c.author)}</strong>${collabSupHTML(c.kind, c.kind === 'ccomment' ? c.supId : c.id, `${c.author}'s comment`)}
                            <span class="collab-detail-comment-time">${esc(when(c.at))}</span>
                        </div>
                        ${parent ? `<div class="collab-detail-reply-to">↳ replying to ${esc(parent.author)}</div>` : ''}
                        <div class="collab-detail-comment-text">${esc(c.text)}</div>
                    </div>`;
                }).join('') : `<div class="collab-detail-empty">${state.session?.id && !planMessagesLoaded() && view.loadingFor && view.filter !== 'community' ? 'Loading conversation…' : 'No comments yet.'}</div>`}
            </div>
            ${canComment ? `<form class="collab-menu-compose collab-detail-compose">
                <textarea rows="2" placeholder="${view.scope === 'plan' ? 'Comment to this plan…' : 'Comment to the community…'}" aria-label="Comment"></textarea>
                <button type="submit">Post</button>
            </form>` : `<div class="collab-menu-note">Sign in to collab on this plan, or switch to 🌐 Community.</div>`}
        </div>`;

    const rerender = () => renderCollabDetail(section, getRecordById(id) || record);

    section.querySelectorAll('.collab-scope-btn').forEach(b => b.addEventListener('click', () => { view.scope = b.dataset.scope; rerender(); }));
    section.querySelectorAll('input[name="collab-detail-filter"]').forEach(r => r.addEventListener('change', () => { view.filter = r.value; rerender(); }));
    section.querySelectorAll('.collab-detail-reactions .collab-react-btn').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const emoji = b.dataset.emoji;
        if (view.scope === 'plan') {
            const { togglePlanReaction } = await import('../presentation/reactions.js');
            togglePlanReaction(id, emoji);
        } else {
            const { toggleCommunityReactionForRecord } = await import('../publicCatalog.js');
            await toggleCommunityReactionForRecord(record, emoji);
        }
        refreshCollabSups('item', id);
        window.dispatchEvent(new CustomEvent('collab-updated', { detail: { kind: 'item', id } }));
        rerender();
    }));

    // Status actions: the same list as the collab menu (minus "More details").
    import('./collabControl.js').then(({ getCollabStatusActions }) => {
        const host = section.querySelector('.collab-detail-status-actions');
        if (!host) return;
        for (const action of getCollabStatusActions('item', id)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'collab-menu-action is-status';
            b.textContent = action.label;
            b.addEventListener('click', async () => {
                if (/Suggest a version/.test(action.label)) {
                    document.getElementById('modal-item-variations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                }
                await action.run();
                rerender();
            });
            host.appendChild(b);
        }
    });

    section.querySelector('.collab-detail-compose')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ta = e.currentTarget.querySelector('textarea');
        const text = ta.value.trim();
        if (!text) return ta.focus();
        let ok = false;
        if (view.scope === 'plan') {
            const user = me();
            ok = !!(await api.postChatMessage(state.session.id, user.id, user.name, text, id));
            if (ok) await api.fetchChatMessages(state.session.id);
        } else {
            const { addCommunityCommentForRecord } = await import('../publicCatalog.js');
            const created = await addCommunityCommentForRecord(record, text);
            ok = !!created;
        }
        if (!ok) return showToast('Could not post that comment.', 3000, 'error');
        refreshCollabSups('item', id);
        rerender();
    });
    section.querySelector('.collab-detail-compose textarea')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); }
    });
}

let wired = false;
/** Keep the open detail's Collab section current as reactions and comments change. */
export function initCollabDetail() {
    if (wired) return;
    wired = true;
    const refresh = () => {
        const section = document.getElementById('modal-collab-section');
        if (!section || section.style.display === 'none' || !view.recordId) return;
        if (section.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA') return;
        const record = getRecordById(view.recordId);
        if (record) renderCollabDetail(section, record);
    };
    window.addEventListener('collab-updated', refresh);
    window.addEventListener('open-conversations-updated', refresh);
    window.addEventListener('pending-collab-sent', refresh);
}

