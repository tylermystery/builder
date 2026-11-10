/**
 * Open chat/task badges for the plan view: one on the plan summary header and
 * one on each item card. Counts come from utils/openConversations.js; selecting a
 * badge opens the plan chat scoped to the plan or the item.
 */
import {
    initOpenConversations,
    getOpenConversationCounts,
    describeOpenCounts,
    getOpenCountsForItems,
    scheduleOpenConversationsRefresh,
} from '../../utils/openConversations.js';
import { openUCPConversations } from '../unifiedChatPanel.js';

let initialized = false;
let frame = null;

export function init({ fetchChatMessages, triggerSave }) {
    initOpenConversations({ fetchChatMessages, triggerSave });
    if (initialized) return;
    initialized = true;

    window.addEventListener('open-conversations-updated', scheduleUpdate);

    const planBadge = document.getElementById('plan-open-convo-badge');
    planBadge?.addEventListener('click', (e) => {
        e.stopPropagation();
        openUCPConversations(null);
    });
}

/** Load this plan's messages so the counts are populated on entry. */
export function refresh() {
    scheduleOpenConversationsRefresh(0);
    scheduleUpdate();
}

export function openForItem(recordId) {
    return openUCPConversations(recordId || null);
}

function scheduleUpdate() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = null;
        updateBadges();
    });
}

function applyCount(el, countEl, counts, emptyTitle) {
    if (countEl) countEl.textContent = counts.total || '';
    el.classList.toggle('has-open', counts.total > 0);
    const title = counts.total > 0 || counts.comments > 0 ? describeOpenCounts(counts) : emptyTitle;
    el.title = title;
    el.setAttribute('aria-label', title);
}

export function updateBadges() {
    const { plan, byItem } = getOpenConversationCounts();

    const planBadge = document.getElementById('plan-open-convo-badge');
    if (planBadge) {
        const countEl = planBadge.querySelector('.plan-open-convo-count');
        applyCount(planBadge, countEl, plan, 'No open chats or tasks');
        if (countEl) countEl.textContent = String(plan.total);
    }

    document.querySelectorAll('.reaction-zone-comments-btn[data-record-id]').forEach(btn => {
        const counts = byItem.get(btn.dataset.recordId) || { chats: 0, tasks: 0, comments: 0, total: 0 };
        applyCount(btn, btn.querySelector('.reaction-zone-open-count'), counts, 'Add a comment');
    });

    document.querySelectorAll('.compact-badge-comment[data-open-group-items]').forEach(badge => {
        const counts = getOpenCountsForItems(badge.dataset.openGroupItems.split(',').filter(Boolean));
        applyCount(badge, badge.querySelector('.compact-badge-count'), counts, '');
        badge.title = `${badge.title} across group`;
        badge.hidden = !(counts.total > 0 || counts.comments > 0);
    });
}
