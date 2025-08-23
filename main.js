/*
 * Version: 2.1.1
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v2.1.1 - 2025-08-23
 * - Refactored all click handlers into a single, unified event listener.
 * - Restored missing storeSession and getStoredSessions functions.
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';

const imageCache = new Map();

// --- CORE LOGIC ---
export function getStoredSessions() { return JSON.parse(localStorage.getItem('savedSessions') || '{}'); }

export function storeSession(id, name) { 
    const sessions = getStoredSessions(); 
    sessions[id] = name;
    localStorage.setItem('savedSessions', JSON.stringify(sessions)); 
}

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
    
    ui.toggleLoading(false);
    setupEventListeners();
    renderTopLevel();
    ui.updateFavoritesCarousel();
}

function setupEventListeners() {
    ui.headerEventNameInput.addEventListener('change', () => { ui.updateHeader(); });
    
    // The single, unified click listener for all card interactions.
    document.body.addEventListener('click', async (e) => {
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const cardBody = e.target.closest('.event-card');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = e.target.closest('.remove-btn');

        // --- Interaction Router ---

        // 1. Handle REMOVE from favorites
        if (removeBtn) {
            e.stopPropagation();
            const recordId = removeBtn.dataset.compositeId;
            state.cart.items.delete(recordId);
            await ui.updateFavoritesCarousel();
            return;
        }

        // 2. Handle HEART click (in catalog or modal)
        if (heartIcon) {
            e.stopPropagation();
            const card = heartIcon.closest('.event-card');
            if (!card) return; // Ignore clicks on favorite item hearts for now
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
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
                heartIcon.classList.remove('hearted');
            } else {
                state.cart.items.set(recordId, itemInfo);
                heartIcon.classList.add('hearted');
            }
            await ui.updateFavoritesCarousel();
            return;
        }

        // 3. Handle PARENT button click (Go Up)
        if (parentBtn) {
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const parentId = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0];
            const parentRecord = state.records.all.find(r => r.id === parentId);
            
            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            }
            return;
        }
        
        // 4. Handle EXPLODE button click
        if (explodeBtn) {
            e.stopPropagation();
            const card = explodeBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);

            const rawOptions = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));

            ui.renderRecords(children, imageCache);
            
            const implodeButton = document.createElement('div');
            implodeButton.id = 'implode-container';
            implodeButton.innerHTML = `<button class="card-btn implode-btn" data-parent-id="${recordId}" title="Implode"> اجمع </button>`;
            document.querySelector('#catalog-container').insertAdjacentElement('beforebegin', implodeButton);
            return;
        }

        // 5. Handle IMPLODE button click
        if (implodeBtn) {
            e.stopPropagation();
            implodeBtn.closest('#implode-container').remove();
            renderTopLevel();
            return;
        }

        // 6. Handle CARD BODY click (in catalog)
        if (cardBody) {
            const recordId = cardBody.dataset.recordId;
            await ui.openDetailModal(recordId, imageCache);
            return;
        }

        // 7. Handle FAVORITE ITEM click (in carousel)
        if (favoriteItem) {
            const recordId = favoriteItem.dataset.recordId;
            await ui.openDetailModal(recordId, imageCache);
            return;
        }
    });

    // Listener for configuration and navigation dropdowns
    document.body.addEventListener('change', async (e) => {
        // Handle configuration changes
        if (e.target.classList.contains('configure-options')) {
            const card = e.target.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = ui.parseOptions(record.fields.Options);
            const initialPrice = parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
            
            const selectedIndex = parseInt(e.target.value, 10);
            const selectedOption = rawOptions[selectedIndex];
            
            let newPrice = initialPrice;
            if (selectedOption) {
                if (selectedOption.absolutePrice != null) {
                    newPrice = selectedOption.absolutePrice;
                } else if (selectedOption.priceChange != null) {
                    newPrice += selectedOption.priceChange;
                }
            }
            card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
            card.querySelector('.description').textContent = selectedOption.description || record.fields.Description || '';
        }

        // Handle navigation changes
        if (e.target.classList.contains('navigate-options')) {
            const card = e.target.closest('.event-card');
            const childName = e.target.value;
            if (!childName) return;
    
            const childRecord = state.records.all.find(r => r.fields.Name === childName);
            if (childRecord) {
                const newCard = await ui.createInteractiveCard(childRecord, imageCache);
                card.replaceWith(newCard);
            }
        }
    });
}

initialize();
