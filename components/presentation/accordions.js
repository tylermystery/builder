/**
 * Accordions
 * Section expand/collapse behavior for the presentation view.
 * Extracted from presentation.js — Phase 1 modularization.
 */

import { log } from '../../utils/debug.js';
import { openActionMenu } from '../actionMenu.js';

// Accordion state (all sections start expanded)
const accordionState = {
    header: true,
    items: true
};

// Module-level state
let allItemsCollapsed = false;

// Dependencies injected via init()
let _getModal = null;
let _getToggleAllBtn = null;

/**
 * Initialize the accordions module.
 * @param {Object} deps
 * @param {Function} deps.getModal - Returns the presentation modal DOM element
 * @param {Function} deps.getToggleAllBtn - Returns the toggle-all button element
 */
export function init({ getModal, getToggleAllBtn }) {
    _getModal = getModal;
    _getToggleAllBtn = getToggleAllBtn;
}

/**
 * Get the current accordion state (for use by other modules, e.g. chat).
 * @returns {Object} The accordion state object
 */
export function getAccordionState() {
    return accordionState;
}

/**
 * Initialize all accordion sections to expanded state.
 */
export function initializeAccordions() {
    const modal = _getModal?.();
    if (!modal) return;

    Object.keys(accordionState).forEach(section => {
        accordionState[section] = true;
        let sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
        if (!sectionEl) {
            sectionEl = modal.querySelector(`.sub-accordion[data-section="${section}"]`);
        }
        if (sectionEl) {
            sectionEl.classList.add('expanded');
        }
    });
}

/**
 * Toggle an accordion section by name.
 * @param {string} section - The section identifier
 */
export function toggleAccordion(section) {
    const modal = _getModal?.();
    if (!modal) return;

    let sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
    if (!sectionEl) {
        sectionEl = modal.querySelector(`.sub-accordion[data-section="${section}"]`);
    }

    if (!sectionEl) return;

    accordionState[section] = !accordionState[section];

    if (accordionState[section]) {
        sectionEl.classList.add('expanded');
    } else {
        sectionEl.classList.remove('expanded');
    }

    log('Presentation', `Accordion ${section} ${accordionState[section] ? 'expanded' : 'collapsed'}`);
}

/**
 * Toggle an individual item accordion.
 * @param {HTMLElement} itemElement - The item accordion element
 */
export function toggleItemAccordion(itemElement) {
    if (!itemElement) return;

    const isExpanded = itemElement.classList.contains('expanded');

    if (isExpanded) {
        itemElement.classList.remove('expanded');
    } else {
        itemElement.classList.add('expanded');
    }

    log('Presentation', `Item accordion ${isExpanded ? 'collapsed' : 'expanded'} for record ${itemElement.dataset.recordId}`);
}

/**
 * Toggle all item accordions (collapse/expand all).
 */
export function toggleAllItemAccordions() {
    const modal = _getModal?.();
    if (!modal) return;

    const itemAccordions = modal.querySelectorAll('.item-accordion');
    if (!itemAccordions || itemAccordions.length === 0) return;

    const shouldExpand = allItemsCollapsed;

    itemAccordions.forEach(item => {
        if (shouldExpand) {
            item.classList.add('expanded');
        } else {
            item.classList.remove('expanded');
        }
    });

    allItemsCollapsed = !shouldExpand;

    const presentationToggleAllBtn = _getToggleAllBtn?.();
    if (presentationToggleAllBtn) {
        const textEl = presentationToggleAllBtn.querySelector('.toggle-all-text');
        if (textEl) {
            textEl.textContent = allItemsCollapsed ? 'Expand All' : 'Collapse All';
        }
        if (allItemsCollapsed) {
            presentationToggleAllBtn.classList.add('collapsed');
        } else {
            presentationToggleAllBtn.classList.remove('collapsed');
        }
    }

    log('Presentation', `All item accordions ${shouldExpand ? 'expanded' : 'collapsed'}`);
}

/**
 * Handle item accordion header clicks.
 * @param {Event} e - Click event
 */
export function handleItemAccordionClick(e) {
    const itemAccordionHeader = e.target.closest('.item-accordion-header');
    if (!itemAccordionHeader) return;

    // If clicking on the emoji indicator, open the action menu instead
    const emojiIndicator = e.target.closest('.item-emoji-indicator');
    if (emojiIndicator) {
        e.stopPropagation();
        const recordId = emojiIndicator.dataset.recordId;
        if (recordId) {
            const rect = emojiIndicator.getBoundingClientRect();
            openActionMenu(recordId, {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            });
        }
        return;
    }

    // Don't trigger accordion on interactive elements
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.reaction-btn')) {
        return;
    }

    const itemElement = itemAccordionHeader.closest('.item-accordion');
    if (itemElement) {
        e.stopPropagation();
        toggleItemAccordion(itemElement);
    }
}

export function cleanup() {
    allItemsCollapsed = false;
    accordionState.header = true;
    accordionState.items = true;
}
