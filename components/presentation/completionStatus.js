import { state } from '../../state.js';
import { getPlanConversationStatuses } from '../../utils/openConversations.js';
import { calculatePlanCompletion } from '../../utils/planCompletion.js';

const labels = { open: 'Open', 'in-progress': 'In progress', complete: 'Complete' };

export function updateCompletionStatus() {
    const summaryEl = document.getElementById('plan-completion-summary');
    if (!summaryEl) return;

    const { entries, ready, error } = getPlanConversationStatuses();
    const { completedItems, archivedItems } = state.session;
    const completion = ready && calculatePlanCompletion(
        [...state.cart.items.keys(), ...state.cart.lockedItems.keys()], completedItems, archivedItems, entries
    );
    const pendingLabel = error ? 'Status unavailable' : 'Checking status…';

    const statusEl = summaryEl.querySelector('.plan-completion-status');
    const detailEl = summaryEl.querySelector('.plan-completion-detail');
    const progressEl = summaryEl.querySelector('progress');
    const statusText = !completion ? pendingLabel : completion.total ? `${labels[completion.status]} · ${completion.percent}%` : 'No work yet';
    let detail = error ? 'Could not load all chats and tasks.' : 'Loading chats and tasks…';
    if (completion) {
        detail = 'Add an item, task, or chat to track progress.';
        if (completion.total) {
            const items = completion.counts.items;
            detail = `${completion.done} of ${completion.total} steps done`;
            if (items.total) detail += ` · ${items.done} of ${items.total} items complete`;
        }
    }
    summaryEl.dataset.status = completion ? completion.status : 'pending';
    if (statusEl.textContent !== statusText) statusEl.textContent = statusText;
    if (detailEl.textContent !== detail) detailEl.textContent = detail;
    progressEl.hidden = !completion?.total;
    if (completion?.total) {
        progressEl.max = completion.total;
        progressEl.value = completion.done;
    }

    document.querySelectorAll('[data-completion-item-id]').forEach(badge => {
        const itemId = badge.dataset.completionItemId;
        const item = completion?.byItem.get(itemId);
        const status = archivedItems?.has(itemId) ? 'archived' : item?.status || 'pending';
        badge.dataset.status = status;
        badge.textContent = status === 'archived' ? 'Archived' : item ? labels[status] : pendingLabel;
        if (item?.total > 1 && !badge.classList.contains('item-completion-inline')) {
            badge.textContent += ` · ${item.done} of ${item.total} done`;
        }
        badge.hidden = ready && !item && status !== 'archived';
    });
}
