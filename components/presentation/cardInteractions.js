/**
 * Card Interactions
 * Click handlers and keyboard navigation for compact cards in board view.
 * Extracted from presentation.js — Phase 4A modularization.
 */

import { log } from '../../utils/debug.js';

// Dependencies injected via init()
let _deps = null;

/**
 * Initialize the card interactions module.
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
 * Initialize click handlers for compact cards in board view.
 * Attaches click + keyboard listeners to item cards, group cards,
 * split buttons, and hybrid split buttons.
 */
export function initializeCompactCardClicks() {
    const itineraryItemsListEl = _deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;

    // Regular item cards - open detail modal on click or Enter/Space key
    const itemCards = itineraryItemsListEl.querySelectorAll('.compact-card[data-record-id]');
    itemCards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger on status badge, emoji indicator, vitality badge, or split button clicks
            const isExcluded = e.target.closest('.compact-card-status') || e.target.closest('.compact-card-emoji') || e.target.closest('.compact-card-split-btn') || e.target.closest('.compact-card-vitality') || e.target.closest('.valuation-vitality-emoji') || e.target.closest('.vitality-score-badge') || e.target.closest('.compact-card-reaction-zone');
            if (isExcluded) {
                console.log('[Presentation DEBUG] Compact card click EXCLUDED (vitality/status/emoji element):', e.target.className);
                return;
            }
            const recordId = card.dataset.recordId;
            const record = _deps.getRecordById(recordId);
            if (record) {
                _deps.showDetailModal(record);
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const recordId = card.dataset.recordId;
                const record = _deps.getRecordById(recordId);
                if (record) {
                    _deps.showDetailModal(record);
                }
            }
        });
    });

    // Group cards - open group detail modal on click or Enter/Space key
    const groupCards = itineraryItemsListEl.querySelectorAll('.compact-card-group[data-group-id]');
    groupCards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't open modal when clicking the split button
            if (e.target.closest('.compact-card-split-btn')) return;
            const groupId = card.dataset.groupId;
            if (groupId) {
                _deps.openGroupDetailModal(groupId);
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const groupId = card.dataset.groupId;
                if (groupId) {
                    _deps.openGroupDetailModal(groupId);
                }
            }
        });
    });

    // Split buttons on group cards - dissolve the group
    const groupSplitBtns = itineraryItemsListEl.querySelectorAll('.compact-card-group .compact-card-split-btn[data-group-id]');
    groupSplitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const groupId = btn.dataset.groupId;
            if (groupId) {
                _deps.dissolveGroup(groupId);
            }
        });
    });

    // Split buttons on hybrid compact cards - uncombine all sources
    const hybridSplitBtns = itineraryItemsListEl.querySelectorAll('.compact-card-split-hybrid[data-target-id]');
    hybridSplitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const targetId = btn.dataset.targetId;
            if (targetId) {
                _deps.uncombineAll(targetId);
            }
        });
    });
}
