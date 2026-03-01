/**
 * Item Actions
 * Item lifecycle actions: archive, complete, lock, delete, goal, reactions, comments.
 * Extracted from presentation.js — Phase 4A modularization.
 */

import { log } from '../../utils/debug.js';

// Dependencies injected via init()
let _deps = null;

/**
 * Initialize the item actions module.
 * @param {Object} deps - All required dependencies
 */
export function init(deps) {
    _deps = deps;
}

/**
 * Cleanup the module.
 */
export function cleanup() {
    _deps = null;
}

/**
 * Archive an item (keeps it in position, changes status).
 */
export async function archiveItem(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Initialize archivedItems if not exists
    if (!state.session.archivedItems) {
        state.session.archivedItems = new Set();
    }

    // Add to archived items (item stays in its position, just changes status)
    state.session.archivedItems.add(recordId);

    // Get item name for toast
    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();
    _deps.updatePlanSummaryDashboard();

    // Show toast notification
    _deps.showToast(`"${itemName}" archived`, 'info');

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} archived`);
}

/**
 * Mark an item as completed.
 */
export async function completeItem(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Initialize completedItems if not exists
    if (!state.session.completedItems) {
        state.session.completedItems = new Set();
    }

    // Add to completed items (item stays in its position, just changes status)
    state.session.completedItems.add(recordId);

    // Get item name for toast
    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();
    _deps.updatePlanSummaryDashboard();

    // Show toast notification
    _deps.showToast(`"${itemName}" marked complete`, 'success');

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} marked completed`);
}

/**
 * Set item as a goal/inspiration (toggle).
 */
export async function setItemAsGoal(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Initialize goalItems if not exists
    if (!state.session.goalItems) {
        state.session.goalItems = new Set();
    }

    // Toggle goal status
    if (state.session.goalItems.has(recordId)) {
        state.session.goalItems.delete(recordId);
        _deps.showToast('Removed from goals', 'info');
    } else {
        state.session.goalItems.add(recordId);
        const record = _deps.getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        _deps.showToast(`"${itemName}" set as goal`, 'success');
    }

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();

    // Update goal chips and trigger plan focus generation
    _deps.planFocus.renderGoalChips();
    _deps.planFocus.triggerPlanFocusGeneration();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} goal status toggled`);
}

/**
 * Move item to Ideas bucket (from lockedItems to items).
 */
export async function moveToIdeas(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Check if item is currently in lockedItems
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        // Move from lockedItems to items
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        // Get item name for toast
        const record = _deps.getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        _deps.showToast(`"${itemName}" moved to Ideas`, 'info');
    } else {
        // Item might already be in ideas, just confirm
        _deps.showToast('Item is already in Ideas', 'info');
    }

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} moved to Ideas`);
}

/**
 * Lock an item (move from items to lockedItems if not already).
 */
export async function lockItem(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Check if item is in items (Ideas)
    const itemInfo = state.cart.items.get(recordId);
    if (itemInfo) {
        // Move from items to lockedItems
        state.cart.items.delete(recordId);
        state.cart.lockedItems.set(recordId, itemInfo);

        const record = _deps.getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        _deps.showToast(`"${itemName}" locked in plan`, 'success');
    } else if (state.cart.lockedItems.has(recordId)) {
        _deps.showToast('Item is already locked', 'info');
    } else {
        // Item not found, add it to locked
        state.cart.lockedItems.set(recordId, { quantity: 1, selections: {} });
        const record = _deps.getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        _deps.showToast(`"${itemName}" locked in plan`, 'success');
    }

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} locked in plan`);
}

/**
 * Demote an item (move from locked to idea status while keeping in view).
 */
export async function demoteItem(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Move from lockedItems to items if applicable
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        const record = _deps.getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        _deps.showToast(`"${itemName}" demoted to idea`, 'info');
    } else {
        _deps.showToast('Item is already an idea', 'info');
    }

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} demoted to idea`);
}

/**
 * Delete an item (remove from plan entirely with confirmation).
 */
export async function deleteItem(recordId) {
    if (!recordId) return;

    const state = _deps.getState();

    // Get item name for confirmation
    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to remove "${itemName}" from the plan?`);
    if (!confirmed) return;

    // Remove from all collections
    state.cart.lockedItems.delete(recordId);
    state.cart.items.delete(recordId);
    state.session.archivedItems?.delete(recordId);
    state.session.completedItems?.delete(recordId);
    state.session.goalItems?.delete(recordId);

    // Remove from plan order if present
    const orderIndex = state.session.planItemOrder?.indexOf(recordId);
    if (orderIndex !== -1 && orderIndex !== undefined) {
        state.session.planItemOrder.splice(orderIndex, 1);
    }

    _deps.showToast(`"${itemName}" removed from plan`, 'info');

    // Re-render items
    await _deps.renderAllItems();
    _deps.generateItemsSummary();
    _deps.updatePresentationHeaderTotal();

    // Update goal chips if the deleted item was a goal
    _deps.planFocus.renderGoalChips();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Item ${recordId} deleted from plan`);
}

/**
 * Add a reaction to an item.
 */
export async function addReactionToItem(recordId, emoji) {
    if (!recordId || !emoji) return;

    const state = _deps.getState();

    // Initialize reactions map if not exists
    if (!state.session.reactions) {
        state.session.reactions = new Map();
    }

    // Get or create the reactions for this item
    let itemReactions = state.session.reactions.get(recordId);
    if (!itemReactions || !(itemReactions instanceof Map)) {
        itemReactions = new Map();
        state.session.reactions.set(recordId, itemReactions);
    }

    // Use current user ID or generate anonymous ID
    const userId = state.session.user?.id || `anon-${Date.now()}`;

    // Multi-emoji model: add emoji to user's set
    let userEmojiSet = itemReactions.get(userId);
    if (!(userEmojiSet instanceof Set)) {
        userEmojiSet = userEmojiSet ? new Set([userEmojiSet]) : new Set();
    }
    userEmojiSet.add(emoji);
    itemReactions.set(userId, userEmojiSet);

    // Get item name for toast
    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';
    _deps.showToast(`${emoji} added to "${itemName}"`, 'success');

    // Re-render items to show updated reactions
    await _deps.renderAllItems();

    // Save session
    _deps.triggerSave();

    // Recalculate vitality (sentiment changed, so goodness scores need updating)
    _deps.requestVitalityRecalc();

    log('Presentation', `Reaction ${emoji} added to item ${recordId}`);
}

/**
 * Add a quick comment to an item.
 */
export async function addQuickCommentToItem(recordId, comment) {
    if (!recordId || !comment) return;

    const state = _deps.getState();

    // Use the existing comment system if available, otherwise add to notes
    const itemInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
    if (itemInfo) {
        // Append to item notes
        const existingNote = itemInfo.note || '';
        const newNote = existingNote ? `${existingNote}\n• ${comment}` : `• ${comment}`;
        itemInfo.note = newNote;
    }

    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';
    _deps.showToast(`Comment added to "${itemName}"`, 'success');

    // Re-render items
    await _deps.renderAllItems();

    // Save session
    _deps.triggerSave();

    log('Presentation', `Quick comment added to item ${recordId}: ${comment}`);
}

/**
 * Open custom comment dialog for an item.
 */
export async function openCustomCommentDialog(recordId) {
    if (!recordId) return;

    const record = _deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Use prompt for simple implementation (can be enhanced with modal later)
    const comment = prompt(`Add a comment to "${itemName}":`);
    if (comment && comment.trim()) {
        await addQuickCommentToItem(recordId, comment.trim());
    }
}
