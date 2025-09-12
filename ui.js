// FILE: ui.js
/*
 * Version: 3.2.0
 * Last Modified: 2025-09-11
 * Changelog:
 * v3.2.0 - 2025-09-11
 * - Refactored pricing helpers out to utils.js to break a circular dependency.
 * v3.1.2 - 2025-09-11
 * - Fixed SyntaxError by restoring the missing updateLockedItemStatusIcons function.
 * - Corrected a faulty import statement that was causing the module to fail.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';
import { createInteractiveCard, updateCardIcon } from './components/card.js';
import { setupItineraryEventListeners, showItineraryModal, hideItineraryModal, renderItineraryHeader, renderItinerary } from './components/itinerary.js';
import { getDayStatus, getCombinedPlanStatus, AVAILABILITY_STATUS, checkAvailability } from './availability.js';
import * as api from './api.js';
import { updateFavoritesCarousel, updateEventPlanSection, updateTotalCost, updateHeader } from './components/sidebar.js';

// Re-export functions from the component modules
export * from './components/card.js';
export * from './components/modal.js';
export * from './components/sidebar.js';
export { parseOptions, setupItineraryEventListeners, showItineraryModal, hideItineraryModal, renderItineraryHeader, renderItinerary, checkAvailability };

export async function updateLockedItemStatusIcons() {
    log('UI', 'Updating locked-in item status icons.');
    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (!selectedDateISO) {
        document.querySelectorAll('.locked-item-status-icon').forEach(icon => {
            icon.textContent = '';
        });
        return;
    }
    const selectedDate = new Date(Array.isArray(selectedDateISO) ? selectedDateISO[0] : selectedDateISO);
    const lockedItems = document.querySelectorAll('.locked-item-card');
    for (const item of lockedItems) {
        const recordId = item.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const busyTimes = await api.fetchCalendarForRecord(record);
        const dayStatus = await getDayStatus(selectedDate, busyTimes, record);
        let statusIconEl = item.querySelector('.locked-item-status-icon');
        if (!statusIconEl) {
            statusIconEl = document.createElement('span');
            statusIconEl.className = 'locked-item-status-icon';
            const actionsContainer = item.querySelector('.locked-item-actions');
            if (actionsContainer) {
                actionsContainer.prepend(statusIconEl);
            }
        }
        statusIconEl.classList.remove('available-full', 'available-partial', 'unavailable');
        switch (dayStatus.status) {
            case AVAILABILITY_STATUS.FULL:
                statusIconEl.textContent = '✅';
                statusIconEl.classList.add('available-full');
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                statusIconEl.textContent = '🟠';
                statusIconEl.classList.add('available-partial');
                break;
            case AVAILABILITY_STATUS.NONE:
                statusIconEl.textContent = '❌';
                statusIconEl.classList.add('unavailable');
                break;
        }
    }
}

export async function updateEventPlanDateDisplay() {
    log('UI', 'Updating event plan date display.');
    const dateInput = document.getElementById('event-date-picker');
    if (!dateInput) return;
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (!dateValue) {
        dateInput.value = 'Select a date';
        dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
        return;
    }
    const selectedDate = new Date(Array.isArray(dateValue) ? dateValue[0] : dateValue);
    const lockedItems = Array.from(state.cart.lockedItems.keys()).map(recordId => state.records.all.find(r => r.id === recordId)).filter(Boolean);
    const overallStatus = await getCombinedPlanStatus(selectedDate, lockedItems);
    dateInput.value = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    dateInput.classList.remove('available-full', 'available-partial', 'unavailable');
    switch (overallStatus) {
        case AVAILABILITY_STATUS.FULL:
            dateInput.classList.add('available-full');
            break;
        case AVAILABILITY_STATUS.PARTIAL:
            dateInput.classList.add('available-partial');
            break;
        case AVAILABILITY_STATUS.NONE:
            dateInput.classList.add('unavailable');
            break;
    }
}

export function updateAllUI(recordId) {
    if (recordId) {
        updateCardIcon(recordId);
    }
    updateFavoritesCarousel();
    updateEventPlanSection();
    updateTotalCost();
    updateEventPlanDateDisplay();
    updateLockedItemStatusIcons();
}

export function updateItineraryModalHeader() {
    const itineraryModal = document.getElementById('itinerary-modal-overlay');
    if (itineraryModal && itineraryModal.classList.contains('active')) {
        renderItineraryHeader();
    }
}

export function toggleLoading(show) {
    log('UI', `Toggling loading screen: ${show ? 'ON' : 'OFF'}`);
    const loadingMessage = document.getElementById('loading-message');
    const mainContent = document.querySelector('.main-content');
    if (loadingMessage) loadingMessage.style.display = show ? 'block' : 'none';
    if (mainContent) mainContent.style.display = show ? 'none' : 'grid';
}

export async function renderRecords(recordsToRender, imageCache, append = false) {
    log('UI', `renderRecords called. Attempting to render ${recordsToRender.length} records.`);
    const catalogContainer = document.getElementById('catalog-container');
    const loadingMessage = document.getElementById('loading-message');
    if (!catalogContainer) {
        console.error("UI ERROR: catalog-container element not found in the DOM!");
        return;
    }
    if (!append) {
        catalogContainer.innerHTML = '';
        if (loadingMessage) {
            loadingMessage.style.display = 'block';
        }
    }
    if (recordsToRender.length === 0 && !append) {
        log('UI', "No records to render, displaying 'No items to show.'");
        catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>";
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }
        return;
    }
    
    const fragment = document.createDocumentFragment();
    const CHUNK_SIZE = 5;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
        const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map(record => createInteractiveCard(record, imageCache));
        const cards = await Promise.all(cardPromises);
        cards.forEach(card => {
            if (card) fragment.appendChild(card);
        });
    }
    catalogContainer.appendChild(fragment);
    if (loadingMessage) {
        loadingMessage.style.display = 'none';
    }
    log('UI', `Rendered ${recordsToRender.length} records to the DOM.`);
}

let mainGetItemState;
export function initStateHelpers(helpers) {
    mainGetItemState = helpers.getItemState;
}
export function getMainGetItemState() {
    return mainGetItemState;
}
export function getItemState(recordId) {
    if (state.cart.items.has(recordId)) {
        return state.cart.items.get(recordId);
    }
    return { quantity: 1, selectedOptionIndex: 0, note: '' };
}
export function updateItemState(recordId, updates) {
    const existing = getItemState(recordId);
    const newState = { ...existing, ...updates };
    state.cart.items.set(recordId, newState);
}
export function updateLockedItemState(recordId, updates) {
    const existing = state.cart.lockedItems.get(recordId) || getItemState(recordId);
    const newState = { ...existing, ...updates };
    state.cart.lockedItems.set(recordId, newState);
}
