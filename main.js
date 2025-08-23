/*
 * Version: 2.0.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.0.0 - 2025-08-23
 * - Implemented configuration-aware hearting/favoriting to save selected options and notes.
 * - Removed obsolete/simplified functions for new hierarchical model.
 */

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
const imageCache = new Map();

// --- STATE & HISTORY ---
export function recordStateForUndo() { /* ...logic... */ }
async function restoreState(newState) { /* ...logic... */ }
function undo() { /* ...logic... */ }
function redo() { /* ...logic... */ }

// --- CORE LOGIC ---
export function getRecordPrice(record, optionIndex = null) {
    let price = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    if (optionIndex !== null) {
        const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) {
                return variation.absolutePrice;
            }
            if (variation.priceChange !== null) {
                price += variation.priceChange;
            }
        }
    }
    return price;
}

function renderTopLevel() {
    const topLevelRecords = state.records.all.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    ui.renderRecords(topLevelRecords, imageCache);
}

// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }
    
    // Logic for loading session from URL...
    
    ui.toggleLoading(false);
    setupEventListeners();
    renderTopLevel(); // Initial render
}

function setupEventListeners() {
    // Header Inputs, Beta Toggles, etc.
    ui.headerEventNameInput.addEventListener('change', () => { ui.updateHeader(); });

    // Main Catalog Container Listener
    ui.catalogContainer.addEventListener('click', async function(e) {
        const card = e.target.closest('.event-card');
        if (!card) return;
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);

        // 1. Handle HEART click
        if (e.target.closest('.heart-icon')) {
            e.stopPropagation();
            
            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childRecordNames = new Set(state.records.all.map(r => r.fields.Name));
            const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
            
            let itemInfo = { quantity: 1, selectedOptionIndex: null, note: '' };

            if (!isGrouping && rawOptions.length > 0) {
                const selectedIndex = card.querySelector('.configure-options').value;
                const note = card.querySelector('.item-note').value;
                itemInfo.selectedOptionIndex = parseInt(selectedIndex, 10);
                itemInfo.note = note;
            }

            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
                e.target.closest('.heart-icon').classList.remove('hearted');
            } else {
                state.cart.items.set(recordId, itemInfo);
                e.target.closest('.heart-icon').classList.add('hearted');
            }
            await ui.updateFavoritesCarousel();
            return;
        }

        // Other click handlers (parent, explode, card body) go here...
    });
    
    // Other listeners (favorites carousel, body for implode, dropdowns)
}

initialize();
