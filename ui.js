// FILE: ui.js
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';
import { createInteractiveCard } from './components/card.js';
import { setupItineraryEventListeners, showItineraryModal } from './components/itinerary.js';
import { getDayStatus, getCombinedPlanStatus, AVAILABILITY_STATUS } from './availability.js';
import * as api from './api.js';
import { showPresentationView, setupPresentationEventListeners } from './components/presentation.js';
import { setupAuthEventListeners, showUserModal, isAuthenticated } from './auth.js';
import { showEventHub, setupEventHubEventListeners } from './components/eventHub.js';

// Re-export functions from all component modules
export * from './components/card.js';
export * from './components/modal.js';
export * from './components/sidebar.js';
export { parseOptions, setupItineraryEventListeners, showItineraryModal };
export { showPresentationView, setupPresentationEventListeners };
export { setupAuthEventListeners, showUserModal, isAuthenticated };
export { showEventHub, setupEventHubEventListeners };


// ... (The rest of the file is the same as your current version)
const lazyLoadObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const element = entry.target;
            if (element.dataset.bgImage) {
                element.style.backgroundImage = `url('${element.dataset.bgImage}')`;
            }
            if (element.dataset.src) {
                element.src = element.dataset.src;
            }
            element.classList.remove('lazy-load');
            observer.unobserve(element);
        }
    });
}, { rootMargin: "0px 0px 200px 0px" });

export function observeLazyImages(container) {
    const lazyElements = container.querySelectorAll('.lazy-load');
    lazyElements.forEach(el => lazyLoadObserver.observe(el));
}

function getDescendantBookableItems(record, allRecords) { /* ... */ }
export function getGroupPriceRange(record) { /* ... */ }
export function getRecordPrice(record, optionIndex = null) { /* ... */ }
export function toggleLoading(show) { /* ... */ }
export async function renderRecords(recordsToRender, imageCache, append = false) { /* ... */ }
let mainGetItemState;
export function initStateHelpers(helpers) { /* ... */ }
export function getMainGetItemState() { /* ... */ }
export function getItemState(recordId) { /* ... */ }
export function updateItemState(recordId, updates) { /* ... */ }
export function updateLockedItemState(recordId, updates) { /* ... */ }
export function updateHeader() { /* ... */ }
export async function updateEventPlanDateDisplay() { /* ... */ }
export async function updateLockedItemStatusIcons() { /* ... */ }
export function updateTotalCost() { /* ... */ }
