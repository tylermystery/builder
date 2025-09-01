/*
 * Version: 3.0.0 (Refactored into Modules)
 * Last Modified: 2025-09-01
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';
import { createInteractiveCard } from './components/card.js';

// Re-export functions from the new component modules so other files can use them
export * from './components/card.js';
export * from './components/modal.js';
export * from './components/sidebar.js';

// --- SHARED HELPER FUNCTIONS ---
// These are used by multiple UI components, so they live in the main hub.

export function getBreadcrumbs(record, allRecords) {
    const breadcrumbs = [];
    let current = record;
    while (current && current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        const parentRecord = allRecords.find(r => r.fields.Name === parentName);
        if (parentRecord) {
            breadcrumbs.unshift(parentRecord);
            current = parentRecord;
        } else {
            break;
        }
    }
    return breadcrumbs;
}

export function getRecordPrice(record, optionIndex = null) {
    let price = parseFloat(String(record?.fields?.[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    if (optionIndex !== null) {
        const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) return variation.absolutePrice;
            if (variation.priceChange !== null) price += variation.priceChange;
        }
    }
    return price;
}

export function getGroupPriceRange(record) {
    // This function's implementation would be here...
    // (It can be copied from the old ui.js file)
}

export function formatPricingType(pricingType) {
    if (!pricingType) return '';
    const type = pricingType.toLowerCase();
    if (type === 'per guest') return '/ guest';
    if (type === 'per hour') return '/ hour';
    return '';
}

// --- CORE UI FUNCTIONS ---

export function toggleLoading(show) {
    log('UI', `Toggling loading screen: ${show ? 'ON' : 'OFF'}`);
    const loadingMessage = document.getElementById('loading-message');
    const mainContent = document.querySelector('.main-container');
    if (loadingMessage) loadingMessage.style.display = show ? 'block' : 'none';
    if (mainContent) mainContent.style.display = show ? 'none' : 'grid';
}

export function renderRecords(recordsToRender, imageCache, append = false) {
    log('UI', `renderRecords called. Attempting to render ${recordsToRender.length} records.`);
    const catalogContainer = document.getElementById('catalog-container');
    if (!catalogContainer) {
        console.error("UI ERROR: catalog-container element not found in the DOM!");
        return;
    }

    if (!append) {
        catalogContainer.innerHTML = '';
    }

    if (recordsToRender.length === 0 && !append) {
        log('UI', "No records to render, displaying 'No items to show.'");
        catalogContainer.innerHTML = "<p style='text-align: center;'>No items to show.</p>";
        return;
    }

    const CHUNK_SIZE = 5;
    for (let i = 0; i < recordsToRender.length; i += CHUNK_SIZE) {
        const chunk = recordsToRender.slice(i, i + CHUNK_SIZE);
        const cardPromises = chunk.map(record => createInteractiveCard(record, imageCache));
        Promise.all(cardPromises).then(cards => {
            log('UI', `Appending a chunk of ${cards.length} card elements to the DOM.`);
            cards.forEach(card => {
                if (card) catalogContainer.appendChild(card);
            });
        });
    }
}

// This function allows events.js to pass its getItemState function to the UI modules
let mainGetItemState;
export function initStateHelpers(helpers) {
    mainGetItemState = helpers.getItemState;
}

// This is needed so that card.js etc. can access it via the UI hub
export function getMainGetItemState() {
    return mainGetItemState;
}

