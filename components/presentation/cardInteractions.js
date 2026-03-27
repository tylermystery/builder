/**
 * Card Interactions
 * Click handlers and keyboard navigation for compact cards in board view.
 * Also includes delegated click handlers for thumbnails, items, expand buttons,
 * and suggestion buttons on the items grid.
 *
 * Extracted from presentation.js — Phase 4A + Phase 6 modularization.
 */

import { log } from '../../utils/debug.js';
import { updateUrl } from '../../utils.js';

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
    // Note: Do NOT reset _deps here. The presentation view may be hidden and
    // re-shown without re-calling init() (syncUiWithUrl closes all overlays before
    // re-opening). Wiping _deps causes initializeCompactCardClicks to fail on re-show.
}

/**
 * Initialize click handlers for compact cards in board view.
 * Attaches click + keyboard listeners to item cards, group cards,
 * split buttons, and hybrid split buttons.
 */
export function initializeCompactCardClicks() {
    const itineraryItemsListEl = _deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) {
        return;
    }

    // Regular item cards - open detail modal on click or Enter/Space key
    const itemCards = itineraryItemsListEl.querySelectorAll('.compact-card[data-record-id]');
    itemCards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger on status badge, emoji indicator, vitality badge, or split button clicks
            const isExcluded = e.target.closest('.compact-card-status') || e.target.closest('.compact-card-emoji') || e.target.closest('.compact-card-split-btn') || e.target.closest('.compact-card-vitality') || e.target.closest('.valuation-vitality-emoji') || e.target.closest('.vitality-score-badge') || e.target.closest('.compact-card-reaction-zone');
            if (isExcluded) {
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

// ============================================
// Delegated click handlers (Phase 6 extraction)
// ============================================

/**
 * Handle thumbnail clicks for image carousel navigation.
 */
export function handleThumbnailClick(e) {
    const thumbnail = e.target.closest('.itinerary-thumbnail');
    if (!thumbnail) return;

    const recordId = thumbnail.dataset.recordId;
    const index = parseInt(thumbnail.dataset.index, 10);

    const itemImagesCache = _deps.itemImagesCache;
    if (!itemImagesCache.has(recordId)) return;

    const cached = itemImagesCache.get(recordId);
    cached.currentIndex = index;

    const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${recordId}"]`);
    if (carousel) {
        const mainImage = carousel.querySelector('.itinerary-main-image');
        if (mainImage && cached.images[index]) {
            mainImage.style.backgroundImage = `url('${cached.images[index]}')`;
        }

        carousel.querySelectorAll('.itinerary-thumbnail').forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });
    }
}

/**
 * Handle clicks on itinerary items and group cards to open detail modals.
 */
export function handleItemClick(e) {
    // Don't trigger if clicking on reactions, thumbnails, expand button, comments, or other interactive elements
    if (e.target.closest('.reaction-btn') ||
        e.target.closest('.itinerary-thumbnail') ||
        e.target.closest('.itinerary-item-reactions') ||
        e.target.closest('.itinerary-item-expand-btn') ||
        e.target.closest('.component-comments-section')) {
        return;
    }

    // Handle clicks on options group card content area (open group detail modal)
    const groupCardContent = e.target.closest('.options-group-card-content');
    if (groupCardContent) {
        if (e.target.closest('.options-group-members-section') ||
            e.target.closest('.options-group-dissolve-btn') ||
            e.target.closest('.leave-group-btn')) return;
        e.stopPropagation();
        const groupId = groupCardContent.dataset.groupId;
        if (groupId) {
            _deps.openGroupDetailModal(groupId);
        }
        return;
    }

    const itemElement = e.target.closest('.itinerary-item-clickable');
    if (!itemElement) return;

    const recordId = itemElement.dataset.recordId;
    if (!recordId) return;

    const record = _deps.getRecordById(recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    log('Presentation', `Opening detail modal for: ${record.fields.Name}`);
    _deps.showDetailModal(record);
}

/**
 * Handle clicks on expand buttons to show full item details.
 */
export function handleExpandButtonClick(e) {
    const expandBtn = e.target.closest('.itinerary-item-expand-btn');
    if (!expandBtn) return;

    e.stopPropagation();
    e.preventDefault();

    // If this is an options group expand button, open the group detail modal
    if (expandBtn.classList.contains('options-group-expand-btn')) {
        const groupId = expandBtn.dataset.groupId;
        if (groupId) {
            _deps.openGroupDetailModal(groupId);
        }
        return;
    }

    const recordId = expandBtn.dataset.recordId;
    if (!recordId) return;

    const record = _deps.getRecordById(recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    log('Presentation', `Expand button clicked - opening detail modal for: ${record.fields.Name}`);
    _deps.showDetailModal(record);
}

/**
 * Handle clicks on suggestion buttons (empty state recommendations).
 */
export function handleSuggestionClick(e) {
    const suggestionBtn = e.target.closest('.presentation-suggestion-btn');
    if (!suggestionBtn) return;

    e.stopPropagation();
    const categoryToFilter = suggestionBtn.dataset.categoryFilter;
    if (!categoryToFilter) return;

    const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, ' ');

    log('Presentation', `Suggestion clicked. Filtering for: ${categoryToFilter}`);

    // Close the presentation view and navigate to the filtered catalog
    _deps.hidePresentationView();
    updateUrl({ category: normalizedCategory, subcategory: null, view: null });

    if (typeof window.applyFiltersAndSort === 'function') {
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
}

/**
 * Open the conversation panel for a specific item.
 */
export function openConversationForItem(recordId) {
    _deps.showUnifiedChatPanel();
    const commentSection = document.querySelector(`.component-comments-section[data-component-id="${recordId}"]`);
    if (commentSection) {
        const body = commentSection.querySelector(`.component-comments-body[data-component-id="${recordId}"]`);
        if (body && body.style.display === 'none') {
            body.style.display = '';
            const toggle = commentSection.querySelector('.component-comments-toggle');
            if (toggle) toggle.classList.add('expanded');
        }
        commentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
